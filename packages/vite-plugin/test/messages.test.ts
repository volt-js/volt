/**
 * The build-time half of messages, from the side a project actually meets it.
 *
 * The compiler's own tests hold the rules; these hold the wiring, which is
 * where a rule quietly stops mattering. A missing key has to reach the build
 * as an error naming the template rather than the module that imported it. An
 * unused message has to reach a person — the accessibility pass learned that
 * the hard way, and warnings go out through the same `this.warn` here. And the
 * catalogue has to arrive as a module the bundler can take apart, not as a
 * file the browser fetches.
 *
 * That last one is the headline claim, and reading the generated source for
 * `export const` cannot check it: a module can be textually perfect and still
 * ship whole, which is what a top-level side effect or a shared lookup table
 * would do. So the end of this file builds two real applications against the
 * plugin and weighs them.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { volt, type VoltPluginOptions } from '../src/index.js';
import { build as viteBuild, createLogger, type Plugin } from 'vite';
import type { RollupOutput } from 'rollup';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const FIXTURE_ID = join(FIXTURES, 'component.ts');
const CATALOG = join(FIXTURES, 'en.json');

const component = (template: string) => `
import { Component } from '@voltdev/core';

@Component({ selector: 'v-toolbar', templateUrl: './${template}' })
export class Toolbar {}
`;

/** What the plugin reported without refusing the build. */
let warned: string[] = [];

interface Context {
  error(message: string): never;
  warn(message: string): void;
  addWatchFile(file: string): void;
}

const context: Context = {
  error(message): never {
    throw new Error(message);
  },
  warn(message) {
    warned.push(message);
  },
  addWatchFile() {},
};

/**
 * Whichever plugin of the last `build()` owns `configResolved`.
 *
 * Not the messages plugin: the root and the command moved to `volt:env` once
 * the server-functions pass needed the root too — an endpoint id is derived
 * from a module path relative to it, and one plugin has to be the answer for
 * all of them.
 */
let resolveConfig: (config: { root: string; command: string }) => void = () => {};

/** The plugins, with the messages one wired to the fixture catalogue. */
function build(messages: Partial<VoltPluginOptions['messages']> = {}) {
  warned = [];
  const all = volt({ messages: { catalog: CATALOG, ...messages } } as VoltPluginOptions);
  const byName = (name: string) => all.find((p) => p.name === name)!;
  const env = byName('volt:env');
  resolveConfig = (config) => call(env, 'configResolved', config);
  return { messages: byName('volt:messages'), templates: byName('volt:templates') };
}

type Hook = (this: Context, ...args: never[]) => unknown;
const call = <T>(plugin: Plugin, hook: keyof Plugin, ...args: unknown[]): T =>
  ((plugin[hook] as Hook).call(context, ...(args as never[])) as T);

/** Bring a plugin up the way Vite would, for the build or for the dev server. */
async function start(plugin: Plugin, command: 'build' | 'serve' = 'build'): Promise<void> {
  resolveConfig({ root: FIXTURES, command });
  await call<Promise<void>>(plugin, 'buildStart');
}

describe('a message key the catalogue does not have', () => {
  it('fails the build, naming the template and the line', async () => {
    const { templates } = build();
    // The template's own file, not the module that declared it: that is the
    // file with the mistake in it.
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).rejects.toThrow(/mistyped\.html:3:/);
  });

  it('names the catalogue the project pointed it at', async () => {
    // The compiler's own default is the words "the catalogue", which tells
    // nobody which file to open. The path is the plugin's to supply, and
    // there is only one line of wiring that does it.
    const { templates } = build();
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).rejects.toThrow(/no such message in .*[\\/]fixtures[\\/]en\.json/);
  });

  it('says what the key should have been', async () => {
    const { templates } = build();
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).rejects.toThrow(/Did you mean `t\('close'\)`\?/);
  });

  it('fails a call that leaves out a parameter the message needs', async () => {
    const { templates } = build();
    // Both halves, and in one regex rather than two alternatives: an
    // alternation here passed for a year against an error that named no file
    // at all, because the second branch matched on its own.
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('halfway.html'), FIXTURE_ID),
    ).rejects.toThrow(/is missing `m`[\s\S]*halfway\.html:2:/);
  });

  it('compiles the same template when no catalogue is configured', async () => {
    warned = [];
    const plugins = volt({});
    const templates = plugins.find((p) => p.name === 'volt:templates')!;
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('mistyped.html'), FIXTURE_ID),
    ).resolves.toBeTruthy();
  });

  it('accepts a template whose keys are all there', async () => {
    const { templates } = build();
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID),
    ).resolves.toBeTruthy();
  });
});

describe('a message nothing asks for', () => {
  it('reaches a person, through the warning channel the build already has', async () => {
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([
      expect.stringContaining('Message `checkoutTotal`'),
      expect.stringContaining('Message `abandoned`'),
    ]);
    // Clickable, or nobody clicks it.
    expect(warned[1]).toContain('en.json:5:');
  });

  it('says nothing about a message a template asks for', async () => {
    // Not `toolbar.html`: both of its keys are ones the component library
    // speaks for itself, so they are spared whatever the call sites say — and
    // a report that stopped hearing templates altogether would still look
    // right. `checkoutTotal` is the application's own, so only the wiring
    // from the template compiler's call sites can account for it.
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);
  });

  it('says nothing about a message a module mentions', async () => {
    // A key used from TypeScript is used, and reporting it would be a warning
    // about correct code — which is how a project ends up with none.
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID);
    call(messages, 'transform', `export const total = t('checkoutTotal', { amount });`, FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);
  });

  it('stays quiet on the dev server, which has only seen what changed', async () => {
    const { messages } = build();
    await start(messages, 'serve');
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([]);
  });

  it('stays quiet when a project turns it off', async () => {
    const { messages } = build({ unused: 'off' });
    await start(messages);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([]);
  });

  it('says nothing at all when the build already failed', async () => {
    // A build that stopped has walked part of the graph, so every message it
    // has not reached yet looks unused.
    const { messages } = build();
    await start(messages);
    await call<Promise<void>>(messages, 'buildEnd', new Error('something else broke'));
    expect(warned).toEqual([]);
  });
});

describe('a second build from the same plugin object', () => {
  // `used` and the catalogue are one closure per `volt()` call, and Vite brings
  // the same plugin object up more than once, for two different reasons that
  // need opposite answers. `build --watch` starts a new build on every change,
  // and that one has to report on itself alone or it would warn about the
  // previous run's graph. A build with a client environment and a server one
  // runs the cycle once for each *within* one build, and that one has to
  // accumulate — the client half has not seen the server's modules, and
  // reporting from it alone calls a server-only message unused.
  const temporary: string[] = [];
  afterAll(() => Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('reports what this build saw, not what the one before it did', async () => {
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);

    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    // Nothing in this cycle asked for `checkoutTotal`, so it is unaccounted
    // for again. Carrying the set over would report the previous run's graph.
    expect(warned).toEqual([
      expect.stringContaining('Message `checkoutTotal`'),
      expect.stringContaining('Message `abandoned`'),
    ]);
  });

  it('reads the catalogue again, so a message added to it is seen', async () => {
    // The catalogue is a watched file: a rebuild is exactly what an edit to it
    // triggers, and answering from the read the first build did would report
    // on a file that no longer exists.
    const dir = await mkdtemp(join(tmpdir(), 'volt-messages-'));
    temporary.push(dir);
    const file = join(dir, 'en.json');
    await writeFile(file, JSON.stringify({ greeting: 'Hello' }), 'utf8');

    const { messages } = build({ catalog: file });
    await start(messages);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `greeting`')]);

    await writeFile(file, JSON.stringify({ greeting: 'Hello', farewell: 'Bye' }), 'utf8');
    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([
      expect.stringContaining('Message `greeting`'),
      expect.stringContaining('Message `farewell`'),
    ]);
  });
});

describe('a build with a client environment and a server one', () => {
  // Vite brings one plugin object up once per environment, and `used` is
  // cleared at each `buildStart`, so each environment reports against its own
  // module graph. That is what a `build --watch` rebuild needs; here it means
  // a message only a server-only module reaches is unaccounted for in the
  // client's graph, and the client's `buildEnd` says so. The report has no way
  // to know the other half of the build exists, so this is a fact to plan
  // around rather than a bug to catch — which is why it is written down.
  const SERVER_ONLY = `export const gone = t('abandoned');`;
  const CLIENT_ONLY = `export const total = t('checkoutTotal', { amount });`;

  it('reports a server-only message from the client half, and the reverse', async () => {
    const { messages } = build();
    await start(messages);
    call(messages, 'transform', CLIENT_ONLY, FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);

    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    call(messages, 'transform', SERVER_ONLY, FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `checkoutTotal`')]);
  });

  it('spares the keys a project names, and only those', async () => {
    // `ignore` is the answer for the message above, and the reason it replaces
    // the default rather than adding to it: an application that renders no
    // Dialog is right to want `close` reported, which is what this run proves
    // by reporting it.
    const { messages } = build({ ignore: ['abandoned'] });
    await start(messages);
    call(messages, 'transform', CLIENT_ONLY, FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned).toEqual([
      expect.stringContaining('Message `close`'),
      expect.stringContaining('Message `pageOf`'),
    ]);
  });
});

describe('the catalogue as a module', () => {
  const temporaryDirs: string[] = [];
  afterAll(() => Promise.all(temporaryDirs.map((d) => rm(d, { recursive: true, force: true }))));

  it('answers to the virtual id', async () => {
    const { messages } = build();
    await start(messages);
    expect(call<string>(messages, 'resolveId', 'virtual:volt-messages')).toBe(
      '\0virtual:volt-messages',
    );
    expect(call<string | null>(messages, 'resolveId', './somewhere.ts')).toBeNull();
  });

  it('serves one function per message', async () => {
    const { messages } = build();
    await start(messages);
    const code = await call<Promise<string>>(messages, 'load', '\0virtual:volt-messages');
    expect(code).toContain('export const close = () => "Close";');
    expect(code).toContain('export const pageOf = (params = {}) =>');
    expect(code).not.toMatch(/^\s*import\b/m);
  });

  it('takes the locale from the catalogue’s own name', async () => {
    const { messages } = build();
    await start(messages);
    const code = await call<Promise<string>>(messages, 'load', '\0virtual:volt-messages');
    expect(code).toContain('export const locale = "en";');
  });

  it('refuses a catalogue whose name is not a language tag', async () => {
    // `messages.json` would derive the tag `messages`, which `Intl` accepts
    // and then formats nothing the way the catalogue meant.
    const all = volt({ messages: { catalog: join(FIXTURES, 'strings.json') } });
    const messages = all.find((p) => p.name === 'volt:messages')!;
    await expect(start(messages)).rejects.toThrow(/set `messages\.locale`/);
  });

  it('refuses a shape no message can have, before a template is compiled', async () => {
    // A nested catalogue used to generate: `home` and `away` taken for plural
    // categories, a switch no locale ever selects an arm of, and a `nav()`
    // returning `undefined` under a declaration promising a string. The read
    // is where it has to stop, because the call-site check passes it too —
    // `nav` is in the catalogue, so `t('nav')` looks fine.
    const dir = await mkdtemp(join(tmpdir(), 'volt-messages-'));
    temporaryDirs.push(dir);
    const file = join(dir, 'en.json');
    await writeFile(file, JSON.stringify({ nav: { home: 'Home', away: 'Away' } }), 'utf8');

    const { messages, templates } = build({ catalog: file });
    await expect(start(messages)).rejects.toThrow(/write `nav\.home` as `navHome`/);
    // And through the template transform, which reads the catalogue itself
    // when `buildStart` never ran — a `vite dev` request for a module.
    await expect(
      call<Promise<unknown>>(templates, 'transform', component('toolbar.html'), FIXTURE_ID),
    ).rejects.toThrow(/group of messages/);
  });

  it('takes the locale it is told, whatever the file is called', async () => {
    const { messages } = build({ locale: 'de-DE' });
    await start(messages);
    const code = await call<Promise<string>>(messages, 'load', '\0virtual:volt-messages');
    expect(code).toContain('export const locale = "de-DE";');
  });

  it('leaves every other module alone', async () => {
    const { messages } = build();
    await start(messages);
    expect(await call<Promise<string | null>>(messages, 'load', 'some/other/module.ts')).toBeNull();
  });
});

describe('the declarations a project type-checks against', () => {
  const TYPES = join(FIXTURES, 'messages.d.ts');
  afterEach(() => rm(TYPES, { force: true }));

  it('are written only when asked for, and name the module the build serves', async () => {
    const { messages } = build({ typesFile: 'messages.d.ts' });
    await start(messages);
    const written = await readFile(TYPES, 'utf8');
    expect(written).toContain(`declare module "virtual:volt-messages" {`);
    expect(written).toContain('pageOf: (params: { n: string | number; m: string | number })');
  });

  it('are not written when nothing asked', async () => {
    const { messages } = build();
    await start(messages);
    await expect(readFile(TYPES, 'utf8')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// What a real build prints
// ---------------------------------------------------------------------------

describe('the unused report from a build nobody stubbed', { timeout: 120_000 }, () => {
  it('reaches the console, and names only the message nothing asks for', async () => {
    // Every other test in this file drives `buildEnd` against a hand-rolled
    // context, so "it warns" is true by construction there: nothing proves
    // Rollup carries a plugin warning out to the logger a person is reading,
    // which is exactly the step the accessibility pass once lost. This one
    // runs the whole build and reads the logger.
    const printed: string[] = [];
    const logger = createLogger('silent', { allowClearScreen: false });
    logger.warn = (message) => void printed.push(message);
    logger.warnOnce = (message) => void printed.push(message);

    await viteBuild({
      root: resolve(import.meta.dirname, '..'),
      configFile: false,
      logLevel: 'silent',
      customLogger: logger,
      plugins: [volt({ messages: { catalog: CATALOG } })],
      build: {
        write: false,
        target: 'esnext',
        minify: false,
        lib: { entry: join(FIXTURES, 'used-message.ts'), formats: ['es'], fileName: 'app' },
      },
    });

    // `close` and `pageOf` are the library's own; `checkoutTotal` is asked for
    // by the entry, which is the control that keeps this from passing against
    // a report that names everything.
    expect(printed).toEqual([expect.stringContaining('Message `abandoned`')]);
    expect(printed[0]).toContain('en.json:5:');
  });
});

// ---------------------------------------------------------------------------
// What a bundler does with it
// ---------------------------------------------------------------------------

describe('a message nobody imported', { timeout: 120_000 }, () => {
  /** The fixture app, bundled against the plugin the way a project would be. */
  async function bundle(entry: string): Promise<string> {
    const result = (await viteBuild({
      root: resolve(import.meta.dirname, '..'),
      configFile: false,
      logLevel: 'silent',
      plugins: [volt({ messages: { catalog: CATALOG, unused: 'off' } })],
      build: {
        write: false,
        target: 'esnext',
        // The assertions below say which strings are gone, so they have to
        // survive as themselves; the byte comparison is between two
        // unminified builds.
        minify: false,
        lib: { entry: join(FIXTURES, entry), formats: ['es'], fileName: 'app' },
      },
    })) as RollupOutput[];
    return result[0]!.output[0].code;
  }

  const both = Promise.all([bundle('one-message.ts'), bundle('every-message.ts')]);

  it('is not in the bundle, and the one that was imported is', async () => {
    const [one] = await both;
    expect(one).toContain('Total:');
    expect(one).not.toContain('Close');
    expect(one).not.toContain('Page ');
    expect(one).not.toContain('Nothing asks for this');
  });

  it('is only absent because the bundler dropped it', async () => {
    // The control. Three strings missing from a bundle proves nothing on its
    // own — the same assertions pass against a module that never held them.
    const [, every] = await both;
    expect(every).toContain('Total:');
    expect(every).toContain('Close');
    expect(every).toContain('Page ');
    expect(every).toContain('Nothing asks for this');
  });

  it('costs an application nothing, so size stops tracking the catalogue', async () => {
    const [one, every] = await both;
    // Roughly 460 B against 1,170 B unminified: the difference is the three
    // messages this application never named and the lookup table that names
    // them all. A generated module with a top-level side effect would collapse
    // it, which is exactly the regression reading the source cannot see.
    expect(one.length).toBeLessThan(every.length / 2);
    expect(one).not.toContain('_all');
  });
});

/**
 * The dynamic-key path, and what it costs the report.
 *
 * `t` from the generated module names every message, so a module that imports
 * it links the catalogue whole — that half is the bundler's, and the bundling
 * tests above weigh it. This half is the report's. A key written out is still
 * readable through that export and still accounted for, however the import
 * renamed it. A key that is an expression is not, and every message left over
 * may be the one it selects — so naming them as unused would be the warning
 * on correct code that teaches a team to switch the report off. Before this,
 * `checkoutTotal` and `abandoned` were both reported against a module that
 * may well have been asking for either.
 */
describe('a module that asks the catalogue for a key nothing can read', () => {
  const dynamic = (clause: string, from = 'virtual:volt-messages') =>
    `import ${clause} from '${from}';\nexport const line = (k: string) => t(k);`;

  /** What the report said after one module was transformed. */
  async function report(source: string): Promise<string[]> {
    const { messages } = build();
    await start(messages);
    call(messages, 'transform', source, FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    return warned;
  }

  it('is named, and stands the report down rather than guessing', async () => {
    const warnings = await report(dynamic('{ t }'));
    expect(warnings).toEqual([expect.stringContaining('for a key this build cannot read')]);
    // The module's own path, so the reply says where to go and not only what
    // is wrong.
    expect(warnings[0]).toContain('component.ts');
    expect(warnings.join('\n')).not.toContain('Message `abandoned`');
    expect(warnings.join('\n')).not.toContain('Message `checkoutTotal`');
  });

  it('still reports when every key was written out, which is what makes the silence mean something', async () => {
    const warnings = await report(
      `import { t } from 'virtual:volt-messages';\nexport const line = () => t('checkoutTotal');`,
    );
    expect(warnings.join('\n')).toContain('Message `abandoned`');
    expect(warnings.join('\n')).not.toContain('Message `checkoutTotal`');
    expect(warnings.join('\n')).not.toContain('cannot read');
  });

  it('reads a key through the name the import gave it', async () => {
    // `import { t as translate }` and then `translate('checkoutTotal')`: the
    // scan beside this one looks for `t(` and sees nothing, so before this the
    // message was reported as asked for by nobody.
    const warnings = await report(
      `import { t as translate } from 'virtual:volt-messages';\n` +
        `export const line = () => translate('checkoutTotal');`,
    );
    expect(warnings.join('\n')).not.toContain('Message `checkoutTotal`');
    expect(warnings.join('\n')).toContain('Message `abandoned`');
  });

  it('reads the exported name, not the local one', async () => {
    // One message under a short name is the shape the report exists to
    // encourage, and standing the report down for it would punish exactly the
    // right code.
    const one = await report(dynamic('{ checkoutTotal as t }'));
    expect(one.join('\n')).not.toContain('cannot read');
    expect(one.join('\n')).toContain('Message `abandoned`');
  });

  it('counts a namespace import and a re-export, which hand on the same thing', async () => {
    expect(
      (
        await report(
          `import * as messages from 'virtual:volt-messages';\n` +
            `export const line = (k: string) => messages.t(k);`,
        )
      ).join('\n'),
    ).toContain('cannot read');
    // A re-export is the one shape the scan cannot follow: whoever calls it
    // imports from here and never mentions the catalogue at all.
    expect((await report(`export { t } from 'virtual:volt-messages';`)).join('\n')).toContain(
      'cannot read',
    );
  });

  it('is about the module the build serves, not the word `t` anywhere', async () => {
    // Another library's `t` is another library's business; only the
    // catalogue's own export names every message in the catalogue.
    const other = await report(dynamic('{ t }', 'some-other-library'));
    expect(other.join('\n')).not.toContain('cannot read');
    expect(other.join('\n')).toContain('Message `abandoned`');
  });

  it('says nothing on a dev server, where the report is off anyway', async () => {
    const { messages } = build();
    await start(messages, 'serve');
    call(messages, 'transform', dynamic('{ t }'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([]);
  });

  it('is forgotten by the build after it', async () => {
    const { messages } = build();
    await start(messages);
    call(messages, 'transform', dynamic('{ t }'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toHaveLength(1);

    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    // The module is not in this build's graph, so this build has a report
    // again — the same answer `used` gives, and for the same reason.
    expect(warned.join('\n')).toContain('Message `abandoned`');
    expect(warned.join('\n')).not.toContain('cannot read');
  });
});

describe('a build with more than one environment', () => {
  // The two environments of one build run the whole cycle each, against the
  // same plugin object. What tells them apart from two builds is only that
  // they overlap, so that is what the plugin counts.
  it('waits for the last environment before reporting', async () => {
    const { messages, templates } = build();

    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    // The second environment starts before the first has ended, which is the
    // whole of the difference from a rebuild.
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    // Nothing yet: the other environment is still walking its graph.
    expect(warned).toEqual([]);

    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);
  });

  it('counts a message that only one environment asked for as asked for', async () => {
    // The finding this fixes: `checkoutTotal` is used by the first
    // environment's modules and by none of the second's. Reported per
    // environment, the second calls it unused and a team learns to switch the
    // warnings off.
    const { messages, templates } = build();

    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    await call<Promise<void>>(messages, 'buildEnd');

    expect(warned.join('\n')).not.toContain('checkoutTotal');
  });

  it('still reports on itself alone once the build after it begins', async () => {
    const { messages, templates } = build();
    await start(messages);
    await call<Promise<unknown>>(templates, 'transform', component('checkout.html'), FIXTURE_ID);
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([expect.stringContaining('Message `abandoned`')]);

    warned = [];
    await call<Promise<void>>(messages, 'buildStart');
    await call<Promise<void>>(messages, 'buildEnd');
    expect(warned).toEqual([
      expect.stringContaining('Message `checkoutTotal`'),
      expect.stringContaining('Message `abandoned`'),
    ]);
  });
});
