/**
 * Messages, compiled rather than loaded.
 *
 * Three claims are worth a test here, and each is checked from the side that
 * could actually be wrong.
 *
 * The first is that the compiler knows more than a bundler: it reads the call
 * sites, so `t('clsoe')` is a build error with a file and a line rather than a
 * raw key rendered into production. That is asserted through `compile`, with
 * the message and the location both, because a diagnostic nobody can navigate
 * to is one nobody acts on.
 *
 * The second is that the generated module says the same thing the runtime
 * does. It is a second implementation of interpolation and plural selection,
 * and a second implementation that disagrees is worse than none — so every
 * message is run through both and compared, across locales whose plural rules
 * differ.
 *
 * The third is the typing, which no assertion in this file can prove because
 * the failure is a compile error. So `tsc` is run over the generated
 * declarations and a consumer written to be wrong, and the errors it reports
 * are the assertion.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CompilerError,
  LIBRARY_MESSAGE_KEYS,
  checkCatalog,
  checkTranslateNames,
  compile,
  formatDiagnostic,
  generateMessages,
  messageShape,
  scanMessageKeys,
  unusedMessages,
  type MessageCatalog,
} from '@voltdev/compiler';
import { DEFAULT_MESSAGES, createLocale, resetLocaleCaches } from '@voltdev/primitives';
// Not part of the package's surface: the names the generator binds are its own
// business, and the test below is what keeps the list of them honest.
import { MODULE_BINDINGS } from '../src/messages.js';

const CATALOG: MessageCatalog = {
  close: 'Close',
  pageOf: 'Page {n} of {m}',
  selected: { one: '{n} file selected', other: '{n} files selected' },
  greeting: 'Hello {name}',
};

// ---------------------------------------------------------------------------
// What a message asks for
// ---------------------------------------------------------------------------

describe('parameters read out of the message', () => {
  const names = (message: MessageCatalog[string]) =>
    messageShape('k', message).params.map((p) => p.name);

  it('finds every placeholder, in the order it is written', () => {
    expect(names('Page {n} of {m}')).toEqual(['n', 'm']);
  });

  it('finds none in a message that takes none', () => {
    expect(names('Close')).toEqual([]);
  });

  it('names a placeholder once however often it appears', () => {
    expect(names('{n} of {m}, page {n}')).toEqual(['n', 'm']);
  });

  it('reads the same spacing the runtime does', () => {
    expect(names('Page { n } of {m}')).toEqual(['n', 'm']);
  });

  it('unions the placeholders across plural forms', () => {
    expect(names({ one: '{n} file in {folder}', other: '{n} files in {folder}' })).toEqual([
      'n',
      'folder',
    ]);
  });

  it('requires a count for a message that inflects, spelled out or not', () => {
    // Without one there is no category to select and the caller silently gets
    // `other` — a bug that reads as a working plural in English and in nothing
    // else.
    const shape = messageShape('k', { other: 'some files' });
    expect(shape.params).toEqual([{ name: 'n', kind: 'count', raw: '{n}' }]);
  });

  it('calls only a plural message’s count a count', () => {
    // `{n}` in a message that does not inflect is an ordinary substitution,
    // and typing it as a number would refuse a string nobody should refuse.
    expect(messageShape('k', 'Page {n}').params[0]!.kind).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

describe('the call sites a template makes', () => {
  const sites = (template: string) => compile(template).messageSites;

  it('records the line a key was asked for on', () => {
    const template = `<p>hello</p>\n<p>{ t('close') }</p>`;
    expect(sites(template)).toEqual([{ key: 'close', params: [], loc: { line: 2, column: 4 } }]);
  });

  it('records the column of the binding the key sits in', () => {
    expect(sites(`<b :title="t('close')"></b>`)[0]!.loc).toEqual({ line: 1, column: 4 });
  });

  it('records the parameter names a call passes', () => {
    expect(sites(`<p>{ t('pageOf', { n: 1, m: 9 }) }</p>`)[0]!.params).toEqual(['n', 'm']);
  });

  it('says it cannot read the parameters when the call computes them', () => {
    // Null rather than empty: an empty list would be read as "passes nothing"
    // and reported as missing every parameter the message has.
    expect(sites(`<p>{ t('pageOf', values) }</p>`)[0]!.params).toBeNull();
    expect(sites(`<p>{ t('pageOf', { ...values }) }</p>`)[0]!.params).toBeNull();
    expect(sites(`<p>{ t('pageOf', { [k]: 1 }) }</p>`)[0]!.params).toBeNull();
  });

  it('sees one in every place a template holds an expression', () => {
    const template =
      `<b :title="t('a')">{ t('b') }</b>\n` +
      `<b :if="t('c')">x</b>\n` +
      `<b :click="say(t('d'))">x</b>\n` +
      `<b :class="{ on: t('e') }">x</b>\n` +
      `<ul><li :for="x in list(t('f'))" :key="x">{ x }</li></ul>\n` +
      `<v-child :label="t('g')" :spread="t('h')"></v-child>`;
    expect(compile(template).messageKeys).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('reports a key once per place it is written, not once per parse', () => {
    // An interpolation is parsed twice — folded, then printed — and a `:class`
    // is tried as toggles before it is printed. Neither is a second call site.
    expect(sites(`<b :class="{ on: t('a') }">{ t('a') }</b>`)).toHaveLength(2);
  });

  it('reports both calls when one expression asks for the same key twice', () => {
    // Deduping by key and position would collapse these to one, and the one
    // it kept would be the first — so the second call's arguments, which are
    // the ones that can be wrong, would never be looked at.
    expect(sites(`<p>{ t('a', { n: 1 }) + t('a', { m: 2 }) }</p>`).map((s) => s.params)).toEqual([
      ['n'],
      ['m'],
    ]);
    expect(sites(`<b :title="t('a', { n: 1 }) + t('a', { m: 2 })">x</b>`)).toHaveLength(2);
  });

  it('leaves a computed key alone rather than guessing', () => {
    expect(sites(`<p>{ t(whichever) }</p>`)).toEqual([]);
  });

  it('checks a key without linking it, so the runtime `t` is what still runs', () => {
    // Reading the call sites is what makes the check possible; it is not yet
    // what decides the import. A template keeps calling the locale provider's
    // `t`, so tree-shaking a message serves a hand-written
    // `import { close } from 'virtual:volt-messages'` and nothing else.
    const { code } = compile(`<p>{ t('close') }</p>`, { catalog: { close: 'Close' } });
    expect(code).toContain("_ctx.t('close')");
    expect(code).not.toContain('volt-messages');
  });
});

// ---------------------------------------------------------------------------
// A key that is not there
// ---------------------------------------------------------------------------

describe('a message key the catalogue does not have', () => {
  const build = (template: string, filename = 'src/toolbar.html') =>
    compile(template, { catalog: CATALOG, catalogFile: 'messages/en.json', filename });

  it('fails the build, naming the template file and the line', () => {
    const template = `<p>fine</p>\n<p>also fine</p>\n<button>{ t('clsoe') }</button>`;
    expect(() => build(template)).toThrow(CompilerError);
    expect(() => build(template)).toThrow(/src\/toolbar\.html:3:/);
  });

  it('says which catalogue is missing it, and what was probably meant', () => {
    expect(() => build(`<p>{ t('clsoe') }</p>`)).toThrow(/no such message in messages\/en\.json/);
    expect(() => build(`<p>{ t('clsoe') }</p>`)).toThrow(/Did you mean `t\('close'\)`\?/);
  });

  it('says to add it when nothing in the catalogue is close', () => {
    expect(() => build(`<p>{ t('checkoutTotal') }</p>`)).toThrow(/Add it there/);
  });

  it('compiles the same template with no catalogue given', () => {
    // The check is opt-in, because the compiler cannot tell a mistyped key
    // from a project that has not adopted the build-time catalogue at all.
    expect(() => compile(`<p>{ t('clsoe') }</p>`)).not.toThrow();
  });

  it('keeps the accessibility warnings the refusal interrupted', () => {
    // They are about other elements, and losing them would mean fixing one
    // finding at a time with a full build between each.
    const template = `<div :click="pick()">x</div>\n<p>{ t('clsoe') }</p>`;
    try {
      build(template);
      expect.unreachable('the missing key should have refused this template');
    } catch (err) {
      expect((err as CompilerError).warnings.map((w) => w.message)).toEqual([
        expect.stringContaining('which no keyboard can reach'),
      ]);
    }
  });

  it('stays quiet about a key it cannot read', () => {
    expect(() => build(`<p>{ t(whichever) }</p>`)).not.toThrow();
  });

  it('reads any `t` with a literal argument as a call site, which reserves the name', () => {
    // The compiler cannot tell the locale's `t` from a component method of the
    // same name, so with a catalogue configured and nothing said about which
    // `t` is which, `t` is spelled for one thing.
    expect(() => build(`<p>{ t('mm-dd') }</p>`)).toThrow(/no such message/);
    expect(() => build(`<p>{ dates.t('mm-dd') }</p>`)).toThrow(/no such message/);
  });

  it('says the name may be somebody else’s when nothing in the catalogue is close', () => {
    // The other explanation for a key that resembles no message: this is not
    // the locale's `t` at all. It belongs in the error, because the person
    // reading it is the only one who knows.
    expect(() => build(`<p>{ dates.t('mm-dd') }</p>`)).toThrow(/name the spellings that are/);
    // Not when a near miss explains it better — a typo is not a collision.
    expect(() => build(`<p>{ t('clsoe') }</p>`)).not.toThrow(/name the spellings/);
  });
});

// ---------------------------------------------------------------------------
// Which `t` is the locale's
// ---------------------------------------------------------------------------

describe('a project that says which spellings of `t` are the locale’s', () => {
  const sites = (template: string, translate?: readonly string[]) =>
    compile(template, { translate }).messageKeys;

  it('reads those, and leaves every other `t` alone', () => {
    const template = `<p>{ locale.t('a') } { dates.t('b') } { t('c') }</p>`;
    expect(sites(template)).toEqual(['a', 'b', 'c']);
    expect(sites(template, ['locale.t'])).toEqual(['a']);
    expect(sites(template, ['locale.t', 't'])).toEqual(['a', 'c']);
  });

  it('names a receiver by what it is reached through last, so `this` is not a spelling', () => {
    expect(sites(`<p>{ this.locale.t('a') }</p>`, ['locale.t'])).toEqual(['a']);
  });

  it('calls a receiver with no name `.t`, which is all anyone can say about it', () => {
    expect(sites(`<p>{ useLocale().t('a') }</p>`, ['locale.t'])).toEqual([]);
    expect(sites(`<p>{ useLocale().t('a') }</p>`, ['.t'])).toEqual(['a']);
  });

  it('gives a component its own `t` back, catalogue and all', () => {
    // The whole point of the list: `dates.t('mm-dd')` is a method call again,
    // and the build that used to refuse it now compiles it.
    const build = (translate?: readonly string[]) =>
      compile(`<p>{ locale.t('close') } { dates.t('mm-dd') }</p>`, {
        catalog: CATALOG,
        catalogFile: 'messages/en.json',
        translate,
      });
    expect(() => build()).toThrow(/no such message/);
    expect(() => build(['locale.t'])).not.toThrow();
  });

  it('refuses a spelling no call site could ever match', () => {
    // An entry that matches nothing does not narrow the check — it switches it
    // off for the calls it was written to cover, and says nothing while it
    // does. Held at the option rather than at the call sites, which would
    // report the absence of a finding, which nothing reports.
    expect(() => checkTranslateNames(['locale.translate'])).toThrow(/is not a way to spell/);
    expect(() => compile(`<p>x</p>`, { translate: ['t()'] })).toThrow(/is not a way to spell/);
    expect(() => checkTranslateNames(['t', 'locale.t', '.t'])).not.toThrow();
    expect(() => checkTranslateNames(undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A parameter that is not passed
// ---------------------------------------------------------------------------

describe('a call that leaves out a parameter the message needs', () => {
  const build = (template: string) =>
    compile(template, { catalog: CATALOG, catalogFile: 'messages/en.json', filename: 'p.html' });

  it('fails the build', () => {
    expect(() => build(`<p>{ t('pageOf', { n: 1 }) }</p>`)).toThrow(/is missing `m`/);
  });

  it('shows what the catalogue writes, so the fix is on screen', () => {
    expect(() => build(`<p>{ t('pageOf', { n: 1 }) }</p>`)).toThrow(
      /"Page \{n\} of \{m\}", so it needs \{ n, m \}; this passes n/,
    );
  });

  it('fails a call that passes nothing at all', () => {
    expect(() => build(`<p>{ t('greeting') }</p>`)).toThrow(/is missing `name`.*passes nothing/s);
  });

  it('fails a plural asked for without its count', () => {
    expect(() => build(`<p>{ t('selected', { file: 1 }) }</p>`)).toThrow(/is missing `n`/);
  });

  it('accepts a call that passes them all', () => {
    expect(() => build(`<p>{ t('pageOf', { n: page(), m: total() }) }</p>`)).not.toThrow();
    expect(() => build(`<p>{ t('close') }</p>`)).not.toThrow();
  });

  it('fails the second call in an expression whose first call is complete', () => {
    // The check runs per call site, not per key: one expression can ask for
    // the same message twice, and a page with a raw `{m}` on it is exactly
    // what this rule exists to stop.
    expect(() =>
      build(`<p>{ t('pageOf', { n: 1, m: 2 }) + t('pageOf', { n: 1 }) }</p>`),
    ).toThrow(/is missing `m`/);
    expect(() =>
      build(`<b :title="t('pageOf', { n: 1, m: 2 }) + t('pageOf', { n: 1 })">x</b>`),
    ).toThrow(/is missing `m`/);
  });

  it('stays quiet when the values are not written out', () => {
    expect(() => build(`<p>{ t('pageOf', values) }</p>`)).not.toThrow();
    expect(() => build(`<p>{ t('pageOf', { ...values }) }</p>`)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A message nothing asks for
// ---------------------------------------------------------------------------

describe('a message nothing asks for', () => {
  const SOURCE = ['{', '  "close": "Close",', '  "greeting": "Hello {name}",', '  "farewell": "Bye"', '}'].join('\n');

  it('is reported, with the line in the catalogue to delete', () => {
    const findings = unusedMessages({ close: 'Close', farewell: 'Bye' }, ['close'], {
      filename: 'messages/en.json',
      source: SOURCE,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('Message `farewell`');
    expect(findings[0]!.loc.line).toBe(4);
    expect(formatDiagnostic(findings[0]!)).toContain('messages/en.json:4:');
  });

  it('is a warning, never a refusal', () => {
    // A key added today for a screen landing next week is not a mistake, and
    // a build that stopped for one would have the rule removed by Friday.
    expect(() =>
      compile(`<p>{ t('close') }</p>`, { catalog: { close: 'Close', farewell: 'Bye' } }),
    ).not.toThrow();
  });

  it('says nothing about a message that is used', () => {
    // Deliberately not one of the library's own keys: those are suppressed
    // whatever the call sites say, so a test written on one would pass with
    // the used set thrown away entirely.
    expect(unusedMessages({ greeting: 'Hello {name}' }, ['greeting'])).toEqual([]);
    expect(unusedMessages({ greeting: 'Hello {name}' }, [])).toHaveLength(1);
  });

  it('says nothing about the strings the component library speaks itself', () => {
    // An application translating `close` is translating what a Dialog says.
    // Its own templates never mention it, and reporting that would be a
    // warning about correct code — the kind that gets the rules switched off.
    expect(unusedMessages({ close: 'Cerrar', noResults: 'Sin resultados' }, [])).toEqual([]);
  });

  it('says nothing about the keys the components look up beyond the defaults', () => {
    // A menu trigger, a removable tag and a copy button each ask a catalogue
    // for a key of their own through `has()`, and speak English otherwise. The
    // pages tell an application to translate them, so a warning here would
    // tell it to delete the translation it was told to write.
    const catalog = {
      menu: 'Menü',
      removeItem: '{label} entfernen',
      tagsCleared: 'Alle Tags entfernt',
      copied: 'Kopiert',
      dragLifted: 'Aufgenommen',
      keyShift: 'Umschalt',
    };
    expect(unusedMessages(catalog, [])).toEqual([]);
  });

  it('reports the library’s own keys when a project names its own list', () => {
    // The list is a default, not a rule: an application that never renders a
    // Dialog is right to want `close` reported, and one with a `brandName` of
    // its own is right to want that spared.
    const catalog = { close: 'Close', brandName: 'Volt' };
    expect(unusedMessages(catalog, [], { ignore: ['brandName'] }).map((f) => f.message)).toEqual([
      expect.stringContaining('Message `close`'),
    ]);
  });

  it('keeps that list in step with the library it mirrors', () => {
    // The compiler depends on nothing, so the list is a copy. This is what
    // stops the copy from drifting.
    expect(LIBRARY_MESSAGE_KEYS).toEqual(expect.arrayContaining(Object.keys(DEFAULT_MESSAGES)));
    expect([...LIBRARY_MESSAGE_KEYS]).toEqual([...LIBRARY_MESSAGE_KEYS].sort());
  });
});

describe('keys mentioned by ordinary source', () => {
  it('are found, so a message used from TypeScript is not called unused', () => {
    const source = `const label = locale.t('close');\nconst other = t("farewell");\n`;
    expect([...scanMessageKeys(source)].sort()).toEqual(['close', 'farewell']);
  });

  it('does not mistake another call for a translation', () => {
    expect([...scanMessageKeys(`format('x'); split('y'); await('z');`)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A catalogue that cannot compile
// ---------------------------------------------------------------------------

describe('a catalogue shape no message can have', () => {
  // The catalogue is JSON, so `MessageCatalog` describes nothing that survives
  // the read. Each shape below used to generate: a function returning
  // `undefined`, declared as returning `string` — a blank where a sentence
  // goes, found in production, which is the failure this pass exists to stop.
  const refuse = (catalog: unknown) =>
    checkCatalog(catalog as MessageCatalog, { catalogFile: 'messages/en.json' });

  it('refuses a nested group, and says what to call it instead', () => {
    expect(() => refuse({ nav: { home: 'Home', away: 'Away' } })).toThrow(
      /`nav` in messages\/en\.json is a group of messages/,
    );
    expect(() => refuse({ nav: { home: 'Home', away: 'Away' } })).toThrow(
      /write `nav\.home` as `navHome`/,
    );
  });

  it('refuses it from the generator too, rather than emitting `undefined`', () => {
    // The two entry points are separate: a catalogue reaches the generator
    // from a test and from a runtime compile without passing the plugin's
    // read, and the generated switch would take `home` and `away` for plural
    // categories no locale ever selects.
    expect(() => generateMessages({ nav: { home: 'Home' } } as never, { locale: 'en' })).toThrow(
      /group of messages/,
    );
  });

  it('refuses a plural with no `other`, which is the arm every count falls to', () => {
    expect(() => refuse({ files: { one: '{n} file' } })).toThrow(
      /`files` in messages\/en\.json has no `other` form/,
    );
    expect(() => refuse({ files: { one: '{n} file', other: '{n} files' } })).not.toThrow();
  });

  it('refuses a category no locale has beside ones it does', () => {
    expect(() => refuse({ files: { other: '{n} files', lots: 'many' } })).toThrow(
      /`files\.lots` in messages\/en\.json is not a plural category/,
    );
  });

  it('refuses a value that is not a string or a set of forms', () => {
    expect(() => refuse({ count: 42 })).toThrow(/`count` in messages\/en\.json is a number/);
    expect(() => refuse({ thing: null })).toThrow(/`thing` in messages\/en\.json is null/);
    expect(() => refuse({ list: ['a', 'b'] })).toThrow(/`list` in messages\/en\.json is a list/);
  });

  it('refuses a form that is not a string', () => {
    expect(() => refuse({ files: { one: 1, other: '{n} files' } })).toThrow(
      /`files\.one` in messages\/en\.json is a number/,
    );
  });

  it('refuses a key that cannot be a function name, wherever the catalogue is read', () => {
    expect(() => refuse({ 'user.name': 'Name' })).toThrow(/userName/);
    expect(() => refuse({ default: 'Default' })).toThrow(/cannot be a message key/);
  });

  it('refuses a key the generated module already binds, and suggests one it does not', () => {
    // `locale` is a valid identifier and a legitimate-looking message name, so
    // it passes every other check here and then emits a module declaring
    // `locale` twice — which does not parse, taking every message in the
    // catalogue with it and reporting a syntax error in generated code.
    expect(() => refuse({ locale: 'Locale' })).toThrow(/the generated module binds that name/);
    expect(() => refuse({ locale: 'Locale' })).toThrow(/`localeMessage` would work/);
    expect(() => refuse({ _nf: 'x' })).toThrow(/the generated module binds that name/);
    expect(() => refuse({ t: 'x' })).toThrow(/the generated module binds that name/);
  });

  it('is the set of names the generator actually binds, and no more', () => {
    // Written by hand and therefore able to fall behind the generator. A
    // helper added later without a line here would be shadowed by a message of
    // its name, silently, in the module the message is in.
    const { code } = generateMessages(CATALOG, { locale: 'en' });
    const bound = new Set<string>();
    for (const match of code.matchAll(/^(?:export )?(?:const|let) ([A-Za-z_$][\w$]*)/gm)) {
      bound.add(match[1]!);
    }
    for (const key of Object.keys(CATALOG)) bound.delete(key);
    expect([...bound].sort()).toEqual([...MODULE_BINDINGS].sort());
  });

  it('accepts the shapes a catalogue is allowed to have', () => {
    expect(() => refuse(CATALOG)).not.toThrow();
    expect(() => refuse({ files: { zero: 'none', one: 'one', other: 'many' } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The generated module
// ---------------------------------------------------------------------------

describe('the module a catalogue compiles to', () => {
  const { code } = generateMessages(CATALOG, { locale: 'en', catalogFile: 'messages/en.json' });

  it('exports one function per message, so a bundler can drop the rest', () => {
    expect(code).toContain('export const close = () => "Close";');
    expect(code).toContain('export const pageOf = (params = {}) =>');
    expect(code).toContain('export const greeting = (params = {}) =>');
  });

  it('imports nothing, so a message costs a string and not a library', () => {
    expect(code).not.toMatch(/^\s*import\b/m);
  });

  it('builds its Intl instances lazily', () => {
    // Constructing a formatter is the expensive half of Intl, and a page that
    // never interpolates a number should not pay for one at import.
    expect(code).toContain('(_nf ??= new Intl.NumberFormat(locale))');
    expect(code).toContain('(_pr ??= new Intl.PluralRules(locale))');
  });

  it('leaves the two helpers out of a catalogue that needs neither', () => {
    const plain = generateMessages({ close: 'Close' }, { locale: 'en' }).code;
    expect(plain).not.toContain('Intl.NumberFormat');
    expect(plain).not.toContain('Intl.PluralRules');
  });

  it('refuses a key that cannot be a function name, and suggests one that can', () => {
    expect(() => generateMessages({ 'user.name': 'Name' }, { locale: 'en' })).toThrow(/userName/);
    expect(() => generateMessages({ default: 'Default' }, { locale: 'en' })).toThrow(
      /cannot be a message key/,
    );
  });

  it('refuses a locale tag it cannot bake into an `Intl` instance', () => {
    // The tag is a constant in the generated module rather than an argument,
    // so a bad one is not a mislabelled catalogue: it is a `RangeError` on the
    // first page that formats a number, in whichever component gets there
    // first. `messages.locale` is set by hand, and this is its only check.
    expect(() => generateMessages({ close: 'Close' }, { locale: 'en_US' })).toThrow(
      /`en_US` is not a language tag/,
    );
    expect(() => generateMessages({ close: 'Close' }, { locale: 'en-GB' })).not.toThrow();
  });
});

describe('a compiled message and the runtime say the same thing', () => {
  interface Case {
    key: string;
    values?: Record<string, string | number>;
  }

  const CASES: Case[] = [
    { key: 'close' },
    { key: 'pageOf', values: { n: 3, m: 12 } },
    { key: 'pageOf', values: { n: 1234, m: 5678 } },
    { key: 'pageOf', values: { n: 'three', m: 'twelve' } },
    { key: 'pageOf', values: { n: 1 } },
    { key: 'greeting', values: { name: 'Ada' } },
    { key: 'selected', values: { n: 0 } },
    { key: 'selected', values: { n: 1 } },
    { key: 'selected', values: { n: 2 } },
    { key: 'selected', values: { n: 5 } },
    { key: 'selected', values: { n: 21 } },
    { key: 'selected' },
  ];

  // Locales whose plural rules and number formats disagree with English, so
  // the comparison is about the two implementations rather than about English.
  for (const tag of ['en-US', 'de-DE', 'pl-PL', 'ar-EG']) {
    it(`agrees in ${tag}`, async () => {
      resetLocaleCaches();
      const { code } = generateMessages(CATALOG, { locale: tag });
      const compiled = (await import(
        `data:text/javascript,${encodeURIComponent(code)}`
      )) as Record<string, (values?: Record<string, string | number>) => string>;
      const runtime = createLocale({ defaultLocale: tag, messages: CATALOG as never });

      for (const { key, values } of CASES) {
        expect(compiled[key]!(values), `${key} ${JSON.stringify(values)}`).toBe(
          runtime.t(key, values),
        );
        expect(compiled.t!(key as never, values as never)).toBe(runtime.t(key, values));
      }
    });
  }

  it('returns the key for a message that is not there, as the runtime does', async () => {
    // A dynamic key is the case the tree-shakeable functions cannot serve, and
    // the case `t` exists for — so the two have to agree about a miss as well
    // as about a hit.
    const { code } = generateMessages(CATALOG, { locale: 'en' });
    const compiled = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as {
      t: (key: string) => string;
    };
    expect(compiled.t('nowhere')).toBe('nowhere');
    expect(createLocale({ defaultLocale: 'en', messages: CATALOG as never }).t('nowhere')).toBe(
      'nowhere',
    );
  });

  it('leaves an unsupplied placeholder standing, the way the runtime does', () => {
    // A visible `{m}` is a bug report; an empty gap is a mystery.
    const { code } = generateMessages(CATALOG, { locale: 'en' });
    expect(code).toContain('_v(params.m, "{m}")');
    expect(createLocale({ defaultLocale: 'en', messages: CATALOG as never }).t('pageOf', { n: 1 }))
      .toBe('Page 1 of {m}');
  });
});

// ---------------------------------------------------------------------------
// The typing, proved by the compiler that would report it
// ---------------------------------------------------------------------------

describe('a catalogue types the calls made against it', () => {
  let dir: string;

  /** Type-check one snippet against the generated declarations. */
  async function check(snippet: string): Promise<string> {
    await writeFile(join(dir, 'use.ts'), snippet, 'utf8');
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [TSC, '-p', join(dir, 'tsconfig.json')],
        { cwd: dir },
      );
      return stdout;
    } catch (err) {
      // `tsc` exits non-zero when it reports anything, which is the case
      // every negative test here is about.
      return (err as { stdout: string }).stdout;
    }
  }

  // Resolved through the package rather than by walking up from this file:
  // pnpm's real path for `typescript` is nowhere near it, and `tsc.js` is not
  // in the package's own exports map.
  const TSC = join(
    dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
    'lib/tsc.js',
  );

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'volt-messages-'));
    const { types } = generateMessages(CATALOG, { locale: 'en', catalogFile: 'messages/en.json' });
    await writeFile(join(dir, 'messages.d.ts'), types, 'utf8');
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'esnext',
          module: 'esnext',
          moduleResolution: 'bundler',
        },
        include: ['use.ts', 'messages.d.ts'],
      }),
      'utf8',
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts every call the catalogue supports', async () => {
    expect(
      await check(
        `import { t, close, pageOf, selected, type Messages } from './messages.js';\n` +
          `const a: string = t('close');\n` +
          `const b: string = t('pageOf', { n: 1, m: 9 });\n` +
          `const c: string = t('selected', { n: 2 });\n` +
          `const d: string = close();\n` +
          `const e: string = pageOf({ n: 'one', m: 'nine' });\n` +
          `const f: keyof Messages = 'greeting';\n` +
          `export { a, b, c, d, e, f, selected };\n`,
      ),
    ).toBe('');
  });

  it('refuses a key that is not in the catalogue', async () => {
    // The whole point: `t('clsoe')` does not compile, rather than rendering
    // "clsoe" on a page in a language nobody on the team reads.
    const output = await check(
      `import { t } from './messages.js';\nexport const a = t('clsoe');\n`,
    );
    expect(output).toContain('use.ts(2,');
    expect(output).toMatch(/'"clsoe"' is not assignable/);
  });

  it('refuses a call that leaves out a parameter', async () => {
    const output = await check(
      `import { t } from './messages.js';\nexport const a = t('pageOf', { n: 1 });\n`,
    );
    expect(output).toMatch(/use\.ts\(2,\d+\).*error/);
    expect(output).toContain("'m' is missing");
  });

  it('refuses a count that is not a number', async () => {
    // A plural form is selected by `Intl.PluralRules`, which has nothing to
    // say about "3" — so the string that would silently take `other`.
    const output = await check(
      `import { t } from './messages.js';\nexport const a = t('selected', { n: '3' });\n`,
    );
    expect(output).toMatch(/use\.ts\(2,\d+\).*error/);
  });

  it('types an import of the virtual module the build serves', async () => {
    const { types } = generateMessages(CATALOG, {
      locale: 'en',
      moduleId: 'virtual:volt-messages',
    });
    await writeFile(join(dir, 'messages.d.ts'), types, 'utf8');
    try {
      expect(
        await check(
          `import { t } from 'virtual:volt-messages';\nexport const a = t('close');\n`,
        ),
      ).toBe('');
      expect(
        await check(
          `import { t } from 'virtual:volt-messages';\nexport const a = t('clsoe');\n`,
        ),
      ).toMatch(/is not assignable/);
    } finally {
      const plain = generateMessages(CATALOG, { locale: 'en' });
      await writeFile(join(dir, 'messages.d.ts'), plain.types, 'utf8');
    }
  });
});
