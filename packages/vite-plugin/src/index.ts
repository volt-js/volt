/**
 * @voltdev/vite-plugin
 *
 * Three build-time jobs, all of which remove work from the browser:
 *
 *  1. **Standard decorators.** `@Component` and `@Prop` are TC39 stage-3
 *     syntax that no engine implements yet. Rather than ship a decorator
 *     runtime to evaluate them, this plugin resolves them: it already knows
 *     every selector and prop name, so it emits the registration call they
 *     would have made and deletes the syntax. Files using decorators Volt does
 *     not own fall back to esbuild, which lowers them the ordinary way.
 *
 *  2. **Template and style compilation.** `templateUrl` becomes a `render`
 *     function built from hoisted `<template>` clones, and `styleUrl` is
 *     compiled from Sass — so no compiler of either kind ships to production
 *     and nothing is parsed at runtime.
 *
 *  3. **The `Signal` namespace.** `export namespace` compiles to a runtime
 *     object, which no bundler can take apart, so `Signal.State` alone holds
 *     the introspection surface in the bundle. The watcher is not part of
 *     that: the graph reaches it directly, so it ships either way. Direct
 *     member accesses are rewritten to imports of the individual members; see
 *     `signals.ts`.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform as esbuildTransform } from 'esbuild';
import MagicString from 'magic-string';
import { compileStringAsync } from 'sass';
import {
  checkCatalog,
  compile,
  CompilerError,
  formatDiagnostic,
  generateMessages,
  scanMessageKeys,
  unusedMessages,
} from '@voltdev/compiler';
import type { A11ySeverity, CodegenTarget, MessageCatalog } from '@voltdev/compiler';
import {
  CLIENT_ID,
  SERVER_ID,
  clientModule as startClientModule,
  resolveStart,
  serverModule as startServerModule,
  type StartOptions,
} from './start.js';
import type { Plugin } from 'vite';
import { DecoratorError, planLowering } from './decorators.js';
import { planServerFunctions, ServerFunctionError } from './server-functions.js';
import { planSignalLowering } from './signals.js';
import { isIdentChar, matchDelimiter, skipQuoted, skipTemplateLiteral } from './scan.js';

export interface VoltPluginOptions {
  /** File pattern to process. Defaults to `.ts`/`.mts` outside node_modules. */
  include?: RegExp;
  exclude?: RegExp;
  /**
   * Compile `template` strings to `render` functions at build time.
   * Turning this off requires importing `@voltdev/core/jit` at runtime.
   */
  precompileTemplates?: boolean;
  /** Module the generated code imports its runtime helpers from. */
  runtimeModule?: string;
  /** Log what the compiler folded away for each template. */
  debug?: boolean;
  /**
   * Drive a `:for` row's bindings from one effect rather than one each.
   *
   * Off while the two shapes are being measured against each other; see
   * `CodegenOptions.groupRowBindings`.
   */
  groupRowBindings?: boolean;

  /**
   * Keep the structure around an error in a production build.
   *
   * On by default, and separate from the message text, which
   * `__VOLT_DEV__` strips regardless. What this keeps is the error's code,
   * the identity of what failed and the link to the full sentence — the
   * things a report can group by once the prose is gone. Turn it off only
   * for a target counting every byte, and accept that a production failure
   * then arrives as a bare code.
   */
  diagnostics?: boolean;

  /**
   * Wire the router, the query cache, server rendering and server functions
   * together, so an application does not have to.
   *
   * Off, and that is the position rather than a default. CSR is first-class
   * here and server rendering is something an application chooses; a turnkey
   * mode that quietly made every project a server project would take the
   * choice away. Turning it on also turns `hydrate` on, because a build that
   * server-renders and a client that builds fresh nodes on top of the result
   * are the two halves of one decision.
   *
   * See `StartOptions` for what an application supplies: a route table and a
   * root component, both by path.
   */
  start?: StartOptions | boolean;
  /**
   * Rewrite `Signal.State` and friends to direct imports.
   *
   * Off means the namespace object reaches the bundle, and with it everything
   * else it holds. There is no behavioural difference either way — turning it
   * off only costs bytes.
   */
  lowerSignals?: boolean;
  /**
   * What the compiler's accessibility rules may do to this build.
   *
   * `error`, the default, refuses a template the rules are certain about.
   * `warn` reports everything and builds anyway, which is what a project
   * reaches for when a rule is wrong about one template and the alternative
   * is switching all of them off. `off` skips the pass.
   */
  a11y?: A11ySeverity;
  /**
   * Compile the client build to hydrate the server's markup rather than to
   * build the page from nothing.
   *
   * Opt-in, and it has to be. This roadmap's position is that client rendering
   * is first-class and server rendering is something an application chooses,
   * never the price of using the framework — so a turnkey mode that quietly
   * made every project a server project would contradict it. It is also not
   * inferable: a project may render on the server for a crawler and ship a
   * client build that never hydrates, and guessing wrong either way produces a
   * page that is silently wrong rather than one that fails.
   *
   * It changes the client emit only. The server environment is chosen by its
   * consumer as before, and `target` is excused from `__VOLT_BUILD__`, so a
   * hydrating client and the server it hydrates hash identically — which they
   * must, or the client would discard every page the server printed.
   */
  hydrate?: boolean;
  /**
   * Module the two halves of a `@Server()` method import from.
   *
   * The client half reaches `<serverModule>/client`, which is a separate entry
   * for a reason: importing the handler or the registry from a page would put
   * the server's share of the feature in the browser, next to a body that was
   * stripped precisely so it would not be there.
   */
  serverModule?: string;
  /**
   * Compile an application's own messages instead of loading them.
   *
   * Given a catalogue, every literal `t('key')` the template compiler saw is
   * checked against it, so a key that is not there fails the build with the
   * template's file and line; and the catalogue is turned into a module of
   * one function per message, which a bundler can take apart. Leaving this
   * out changes nothing: the runtime catalogue on `createLocaleProvider` is
   * still there, still the fallback, and still the whole story for a project
   * with no build step.
   */
  messages?: VoltMessagesOptions;
}

export interface VoltMessagesOptions {
  /** The catalogue, absolute or relative to the project root. */
  catalog: string;
  /**
   * The BCP 47 tag it is written in, baked into the generated `Intl`
   * instances. Defaults to the file's own name, which is how a catalogue is
   * conventionally named: `messages/de-DE.json`.
   */
  locale?: string;
  /** What the generated module answers to. Defaults to `virtual:volt-messages`. */
  id?: string;
  /**
   * Which spellings of `t` in a template are the locale's — `['locale.t']`.
   *
   * Leaving it out reads every `t('literal')` and every `<anything>.t(...)` as
   * a message, which is the widest check and the reason `t` is a reserved name
   * once a catalogue is configured: a component method of that name turns its
   * argument into a message key, and a key the catalogue has not got into a
   * build error on correct code. The compiler cannot tell one `t` from
   * another and will not guess, so a project that needs the name back says
   * which spellings are the locale's here — and gives up the check on every
   * other one, which is the trade it is making knowingly.
   */
  translate?: readonly string[];
  /**
   * Where to write the declarations, if anywhere.
   *
   * Opt-in because it writes into somebody's repository. Point it at a file
   * the project's tsconfig includes and `t('clsoe')` stops compiling.
   */
  typesFile?: string;
  /**
   * Whether a message nothing asks for is reported. `warn` is the default and
   * only applies to a production build: a dev-server rebuild transforms the
   * modules that changed, so the set of call sites it has seen is a fraction
   * of the application's and every message would look unused.
   *
   * A build where something asked the generated `t` for a key it computes
   * reports that instead: the key is an expression, so any message may be the
   * one it selects and naming them would be a warning about correct code.
   */
  unused?: 'warn' | 'off';
  /**
   * Keys the unused report never names, whatever the call sites say.
   *
   * Naming a list replaces the default rather than adding to it, because the
   * default is the strings `@voltdev/primitives` speaks for itself and an
   * application that renders no Dialog is right to want `close` reported. It
   * is also the answer for a message only a server-only module reaches: a
   * client build never walks those, so it has nothing to account for the key
   * with.
   */
  ignore?: readonly string[];
}

const DEFAULT_MESSAGES_ID = 'virtual:volt-messages';

const DEFAULT_INCLUDE = /\.m?ts$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;
const RUNTIME_NAMESPACE = '__volt_rt';

/**
 * Which side of the render an environment is, which is the only place that
 * knows.
 *
 * Vite's own default for an environment that does not say, so `vite dev`'s SSR
 * environment and a build's server environment answer the same. It decides
 * three things together, and they have to agree: `__VOLT_SERVER__`, which half
 * of a `@Server()` method is emitted, and which emit a template gets.
 */
function sideOf(environment: { config?: { consumer?: string } } | undefined): 'client' | 'server' {
  return environment?.config?.consumer === 'server' ? 'server' : 'client';
}

/**
 * The module generated code imports from, per side.
 *
 * The same two names the compiler defaults to, and it has to be: this plugin
 * writes the import while the compiler decides the hash, so a disagreement
 * here is an import of a module that has none of the helpers being called.
 */
function defaultRuntime(target: CodegenTarget): string {
  // Hydration is the client runtime: `hClaim`, `hClose` and `hInsert` live in
  // `dom.ts` beside the bindings they hand nodes to, and are reached through
  // the same entry.
  return target === 'server' ? '@voltdev/core/server' : '@voltdev/core/runtime';
}

/**
 * Which of the three emits this environment gets.
 *
 * The server side is decided by the environment, as it always was. The client
 * side is the one with a choice to make, and the project makes it.
 */
function targetFor(
  environment: { config?: { consumer?: string } } | undefined,
  hydrate: boolean,
): CodegenTarget {
  const side = sideOf(environment);
  return side === 'server' ? 'server' : hydrate ? 'hydrate' : 'client';
}

/** Two spaces, so a generated render function reads like the file around it. */
function indentBody(body: string): string {
  return body
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}
const DEFINE_LOCAL = '__volt_define';

export function volt(options: VoltPluginOptions = {}): Plugin[] {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  /**
   * Where generated code reaches its helpers, when a project has not said.
   *
   * Resolved here for the import this plugin writes, and *not* passed on to
   * the compiler, which defaults it the same way per target. That matters:
   * `runtimeModule` is covered by `__VOLT_BUILD__`, so pinning it to one
   * side's spelling would give the two builds different hashes and a client
   * would discard every page the server printed. An option nobody set hashes
   * the same on both sides however differently it resolves.
   */
  const runtimeFor = (target: CodegenTarget): string =>
    options.runtimeModule ?? defaultRuntime(target);
  const precompile = options.precompileTemplates ?? true;
  const groupRowBindings = options.groupRowBindings ?? false;
  const lowerSignals = options.lowerSignals ?? true;
  const serverModule = options.serverModule ?? '@voltdev/server';
  const start = options.start ? resolveStart(options.start === true ? true : options.start) : null;
  // `start` implies it: the server writes the markup and the client attaches
  // to it, and a client emit that built its own would be the second half of
  // that pair contradicting the first.
  const hydrate = options.hydrate ?? start !== null;

  const shouldProcess = (id: string): boolean => {
    const clean = id.split('?')[0] ?? id;
    return include.test(clean) && !exclude.test(clean);
  };

  const messages = options.messages;
  const messagesId = messages?.id ?? DEFAULT_MESSAGES_ID;
  /** Rollup's convention for a module no file backs. */
  const resolvedMessagesId = `\0${messagesId}`;

  /**
   * Every message key anything in this build asked for.
   *
   * Templates contribute exactly what they ask for, because they are parsed.
   * Ordinary modules contribute a lexical scan, which over-collects — and
   * that is the safe direction, since the only thing this set decides is
   * which messages to report as unused.
   */
  const used = new Set<string>();
  /**
   * Modules that asked the catalogue for a key this build cannot read.
   *
   * Only the generated `t` can be asked that way, and it names every message,
   * so two things follow at once and only one of them is about bytes. The
   * catalogue ships whole, which the project chose. And the unused report is
   * a statement about the whole set of call sites, which nobody can make once
   * one of them is an expression.
   */
  const dynamicCallers = new Set<string>();
  /**
   * Modules that imported the catalogue's `t`.
   *
   * A superset of the one above, and a different finding: that one is about a
   * report nobody can make, this one is about bytes nobody asked for. `t`
   * names every message, so a module that imports it puts the whole catalogue
   * in whatever chunk it lands in — and for a call with the key written out,
   * which is most of them, the fix is one import away. Kept with the keys each
   * asked for, because naming them is what makes the reply a fix rather than a
   * complaint.
   */
  const wholeCatalogue = new Map<string, string[]>();
  /**
   * Environments of this build that have started and not yet ended.
   *
   * A build with a client environment and a server one runs the whole cycle
   * once for each, against one plugin instance. `used` is shared, so the only
   * thing that made the report per-environment was clearing it at every
   * `buildStart` — the second environment wiped what the first had seen, and a
   * message only a server-only module asks for was reported as used by nobody.
   * Counting the environments in flight makes the window the build rather than
   * the environment: cleared when the first starts, reported when the last
   * ends.
   */
  let environmentsBuilding = 0;
  let root = process.cwd();
  let isBuild = false;

  /**
   * The catalogue, read once and kept.
   *
   * Held as a promise rather than a value so the template transform can await
   * the same read `buildStart` began, instead of racing it or repeating it.
   */
  let catalog: Promise<LoadedCatalog> | null = null;

  const loadCatalog = (): Promise<LoadedCatalog> | null => {
    if (!messages) return null;
    catalog ??= readCatalog(resolvePath(root, messages.catalog), messages.locale);
    return catalog;
  };

  /**
   * The catalogue as modules, by the id each answers to.
   *
   * Generated once per read of the catalogue rather than once per `load`: a
   * project with a thousand messages is a thousand parts, and a build asks for
   * as many of them as it links.
   */
  let modules: ReadonlyMap<string, string> | null = null;
  const messageModules = (loaded: LoadedCatalog): ReadonlyMap<string, string> => {
    // `moduleId` is what asks for the parts, and every message is one — which
    // is how a message ends up in the chunk of the route that uses it rather
    // than in a chunk every route shares.
    return (modules ??= generateMessages(loaded.catalog, {
      locale: loaded.locale,
      catalogFile: loaded.file,
      moduleId: messagesId,
    }).modules!);
  };

  const templatePlugin: Plugin = {
    name: 'volt:templates',
    // Must see the original source, before decorators are lowered away.
    enforce: 'pre',
    async transform(code, id) {
      if (!precompile || !shouldProcess(id)) return null;
      if (!code.includes('@Component')) return null;

      const loaded = await loadCatalog();

      try {
        return await compileTemplates(code, id, {
          target: targetFor(this.environment, hydrate),
          runtimeModule: options.runtimeModule,
          debug: options.debug ?? false,
          groupRowBindings,
          a11y: options.a11y,
          catalog: loaded?.catalog,
          catalogFile: loaded?.file,
          translate: messages?.translate,
          watch: (file) => this.addWatchFile(file),
          warn: (message) => this.warn(message),
          use: (key) => used.add(key),
        });
      } catch (err) {
        if (err instanceof CompilerError) {
          // Softer findings from the same template, which the error ended the
          // pass before it could return. They are about other elements, and
          // the author is about to be editing this file anyway.
          for (const warning of err.warnings) this.warn(formatDiagnostic(warning));
          // The message already names the template's own file, which for a
          // templateUrl is not this module.
          this.error(err.filename ? err.message : `${err.message}\n  in ${id}`);
        }
        throw err;
      }
    },
  };

  const signalPlugin: Plugin = {
    name: 'volt:signals',
    enforce: 'pre',
    transform(code, id) {
      if (!lowerSignals || !shouldProcess(id)) return null;
      // The namespace can only be reached through a binding called `Signal`,
      // whatever it was renamed to locally.
      if (!code.includes('Signal')) return null;

      const plan = planSignalLowering(code);
      if (plan.kind !== 'lowered') {
        // Declining is invisible in the output, so the only way to find out
        // that a module still carries the namespace is to be told.
        if (options.debug && plan.kind === 'declined') {
          console.info(`[volt] ${id}: Signal namespace kept — ${plan.reason}`);
        }
        return null;
      }

      const s = new MagicString(code);
      for (const { start, end, text } of plan.rewrites) s.overwrite(start, end, text);
      const named = plan.imports.map((it) => `${it.exported} as ${it.local}`).join(', ');
      s.appendLeft(plan.importAt, `import { ${named} } from ${JSON.stringify(plan.importFrom)};\n`);
      return { code: s.toString(), map: s.generateMap({ hires: true, source: id }) };
    },
  };

  /**
   * `@Server()` — the two halves of a server function.
   *
   * Ahead of the decorator lowering, which must never see one: that pass falls
   * back to esbuild for anything it does not recognise, and a `@Server()` left
   * for esbuild is a server body evaluated in a browser. Where it declines,
   * this one fails the build.
   */
  const serverPlugin: Plugin = {
    name: 'volt:server-functions',
    enforce: 'pre',
    transform(code, id) {
      if (!shouldProcess(id)) return null;
      // The module specifier is half of the gate because the pass has one
      // refusal that fires when `@Server` is *absent*: a file that imported the
      // decorator under another name has no other mark on it, and letting it
      // past here is letting an unchecked server body into the browser.
      if (!code.includes('@Server') && !code.includes(serverModule)) return null;

      // Which half to emit is the environment's answer, never the file's — the
      // same decision, and the same default, as `__VOLT_SERVER__` above.
      const side = sideOf(this.environment);

      let plan;
      try {
        plan = planServerFunctions(code, { side, id, root, module: serverModule });
      } catch (err) {
        if (err instanceof ServerFunctionError) this.error(`${err.message}\n  in ${id}`);
        throw err;
      }
      if (plan.kind === 'none') return null;

      const s = new MagicString(code);
      for (const { start, end } of plan.removals) s.remove(start, end);
      for (const { start, end, text } of plan.overwrites) s.overwrite(start, end, text);
      for (const { at, text } of plan.insertions) s.appendRight(at, text);
      s.prepend(plan.prelude);

      if (options.debug) {
        for (const endpoint of plan.endpoints) {
          console.info(`[volt] ${side}: ${endpoint.name} -> ${endpoint.id}`);
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true, source: id }) };
    },
  };

  const decoratorPlugin: Plugin = {
    name: 'volt:decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!shouldProcess(id)) return null;
      // Cheap gate: `@` followed by a name is the only thing worth scanning
      // for, and the scan itself ignores comments and strings.
      if (!/@[A-Za-z_$]/.test(code)) return null;

      let plan;
      try {
        plan = planLowering(code, DEFINE_LOCAL);
      } catch (err) {
        if (err instanceof DecoratorError) this.error(`${err.message}\n  in ${id}`);
        throw err;
      }

      if (plan.kind === 'none') return null;

      if (plan.kind === 'lowered') {
        const s = new MagicString(code);
        for (const { start, end } of plan.removals) s.remove(start, end);
        for (const { at, text } of plan.insertions) s.appendRight(at, text);
        s.prepend(
          `import { defineComponent as ${DEFINE_LOCAL} } from ` +
            `${JSON.stringify(runtimeFor(targetFor(this.environment, hydrate)))};\n`,
        );
        // Only decorators were removed, so what is left is ordinary
        // TypeScript that Vite's own transformer handles.
        return { code: s.toString(), map: s.generateMap({ hires: true, source: id }) };
      }

      // Decorators Volt does not own: esbuild lowers the file, runtime and all.
      const result = await esbuildTransform(code, {
        loader: 'ts',
        // es2022 keeps modern output while still lowering decorators, which
        // esnext would leave in place as unsupported syntax.
        target: 'es2022',
        sourcefile: id,
        sourcemap: true,
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: false,
            useDefineForClassFields: true,
          },
        },
      });

      return { code: result.code, map: result.map };
    },
  };

  const envPlugin: Plugin = {
    name: 'volt:env',
    // Where and what kind of build, for every pass in this file. It lives here
    // rather than beside the one that used to own it because the server
    // functions pass needs the root as well: an endpoint id is derived from a
    // module path relative to it, and a path relative to the wrong directory
    // is an id the other build does not agree with.
    configResolved(config) {
      root = config.root;
      isBuild = config.command === 'build';
    },
    config(_config, env) {
      return {
        define: {
          // Volt guards its explanatory error messages with this so a
          // production bundle carries none of them. Defined here rather than
          // left to the app, because forgetting it would mean either shipping
          // every diagnostic or crashing on an undefined identifier.
          __VOLT_DEV__: JSON.stringify(env.mode !== 'production'),
          // The other half of that flag, and deliberately not the same value.
          // `__VOLT_DEV__` gates the words in an error; this gates the code,
          // the detail and the documentation link around them — which is what
          // makes a production stack trace into minified framework code worth
          // reading at all. On in production for that reason. A build counting
          // every byte can define it `false` itself and get a bare code, and
          // the constant is read through `typeof` so a build that defines
          // neither keeps its diagnostics rather than crashing.
          __VOLT_DIAGNOSTICS__: JSON.stringify(options.diagnostics ?? true),
          // The browser's answer, and the one anything that never reaches an
          // environment falls back to. Which side a module is really compiled
          // for is decided per environment, below.
          __VOLT_SERVER__: 'false',
        },
      };
    },
    /**
     * Which side of the render this build is, answered per environment.
     *
     * It cannot be answered in `config`, for two reasons. A `define` returned
     * from there is one value for every environment, and a build has two — so
     * a wider predicate would compile the *client* modules of an SSR build as
     * a server build, dropping `onMount` from the page. And `isSsrBuild` is
     * set by Vite for a build only: on a dev server it is undefined, so the
     * modules a `vite dev` runs through its SSR environment would be told
     * they were in a browser — which is the mode an SSR application is
     * developed in, and where every gate would be inert.
     *
     * The answer decides behaviour, not just diagnostics: a client bundle
     * drops the request scoping and the server's flushing, and a server
     * bundle never queues `onMount`.
     */
    configEnvironment(name, config) {
      // Vite's own default for an environment that does not say: everything
      // that is not the client consumes on a server.
      const consumer = config.consumer ?? (name === 'client' ? 'client' : 'server');
      return { define: { __VOLT_SERVER__: JSON.stringify(consumer === 'server') } };
    },
  };

  /**
   * The catalogue as a module of one function per message.
   *
   * Separate from the template plugin because it does a different job for a
   * different half of the codebase: templates are checked, ordinary modules
   * are only read for which keys they mention, and the report that needs both
   * can only run once the whole graph has been walked.
   */
  const messagePlugin: Plugin = {
    name: 'volt:messages',

    async buildStart() {
      if (!messages) return;
      // Cleared when the build begins rather than when an environment does, so
      // a watch-mode rebuild still reports what this run saw and nothing
      // earlier, while the two environments of one run accumulate together.
      if (environmentsBuilding === 0) {
        used.clear();
        dynamicCallers.clear();
        wholeCatalogue.clear();
      }
      environmentsBuilding++;
      catalog = null;
      modules = null;
      const loaded = await loadCatalog();
      if (!loaded) return;
      this.addWatchFile(loaded.file);

      if (messages.typesFile) {
        const { types } = generateMessages(loaded.catalog, {
          locale: loaded.locale,
          catalogFile: loaded.file,
          moduleId: messagesId,
        });
        await writeFile(resolvePath(root, messages.typesFile), types, 'utf8');
      }
    },

    resolveId(id) {
      if (start && (id === SERVER_ID || id === CLIENT_ID)) return `\0${id}`;
      if (!messages) return null;
      if (id === messagesId) return resolvedMessagesId;
      // The parts, which only the module above imports — by the name a project
      // would use, so that one `resolveId` answers for both.
      if (id.startsWith(`${messagesId}/`)) return `\0${id}`;
      return null;
    },

    async load(id) {
      if (start && id === `\0${SERVER_ID}`) return startServerModule(start);
      if (start && id === `\0${CLIENT_ID}`) return startClientModule(start);
      if (!messages || !id.startsWith(resolvedMessagesId)) return null;
      const loaded = await loadCatalog();
      if (!loaded) return null;
      const part = messageModules(loaded).get(id.slice(1));
      if (part !== undefined) return part;
      // Only a hand-written import can ask for a part that is not there, and
      // the answer it would otherwise get is Rollup's — a module id nothing
      // loaded, which names neither the catalogue nor the key.
      throw new Error(
        `[volt:messages] \`${id.slice(1)}\` is not a message in ${loaded.file}. ` +
          `Import it from \`${messagesId}\` — \`import { ${id.slice(messagesId.length + 2)} } ` +
          `from '${messagesId}'\` — which is the only spelling of a message this build serves.`,
      );
    },

    transform(code, id) {
      // Not a template, so nothing here is checked — only noted, so that a
      // message used from TypeScript is not reported as used by nobody.
      // `shouldProcess` is the whole decision: the generated module answers to
      // a `\0`-prefixed id, which matches no source-file pattern, so it never
      // reaches here to be scanned as if it were somebody's source.
      if (!messages || !shouldProcess(id)) return null;
      scanMessageKeys(code, used);
      // The catalogue's own `t` as well, which the scan above cannot see once
      // an import renamed it — and which is the only call that can ask for a
      // key nothing here can read.
      const through = catalogueCalls(code, messagesId);
      for (const key of through.keys) used.add(key);
      if (through.unreadable) dynamicCallers.add(id);
      if (through.imported) wholeCatalogue.set(id, through.keys);
      return null;
    },

    async buildEnd(error) {
      if (!messages) return;
      // Decremented before any early return, or an environment that bailed
      // would leave the count above zero and the last one would never report.
      environmentsBuilding = Math.max(0, environmentsBuilding - 1);
      // Another environment of this build is still walking its graph, and it
      // may be the one that uses the message this environment did not.
      if (environmentsBuilding > 0) return;
      if (error) return;
      // A dev-server rebuild transforms the modules that changed and nothing
      // else, so it has seen a fraction of the call sites. Reporting from
      // there would mean warning about messages that are used — which is the
      // finding that teaches a team to switch the warnings off.
      if (!isBuild) return;

      const loaded = await loadCatalog();
      if (!loaded) return;

      // What importing `t` costs, said whether or not the unused report runs:
      // `unused` is about a report, and this is about the bundle. Every
      // message is a module of its own so that a chunk holds the ones its
      // routes ask for — and `t` is the one export that undoes that, because
      // it names them all. A module already named below is left to that
      // reply, which says the same thing about a call this one cannot fix.
      for (const [id, keys] of [...wholeCatalogue].sort()) {
        if (dynamicCallers.has(id)) continue;
        const asked = [...new Set(keys)];
        const rest = Object.keys(loaded.catalog).length - asked.length;
        this.warn(
          `[volt:messages] \`${relative(root, id)}\` imports \`t\` from \`${messagesId}\`, ` +
            `which names every message. The whole catalogue follows it into the chunk that ` +
            `module lands in, so the messages this build split up arrive together anyway.\n` +
            (asked.length > 0
              ? `  It asks for ${asked.map((key) => `\`${key}\``).join(', ')} — ` +
                `\`import { ${asked.join(', ')} } from '${messagesId}'\` links ${
                  asked.length === 1 ? 'that one string' : 'those strings'
                }` + (rest > 0 ? ` and leaves the other ${rest} behind.` : '.')
              : `  Import the messages it needs by name instead, and a bundler ships those ` +
                `strings and no others.`),
        );
      }

      if ((messages.unused ?? 'warn') === 'off') return;

      // A module reached for the dynamic-key path, so every remaining key may
      // be the one it computes. Naming them as unused would be the warning on
      // correct code that teaches a team to switch the report off — and the
      // report is not the only thing that module cost, so the reply says what
      // it did cost instead.
      if (dynamicCallers.size > 0) {
        const where = [...dynamicCallers].sort().map((id) => relative(root, id));
        this.warn(
          `[volt:messages] ${where.map((id) => `\`${id}\``).join(', ')} ` +
            `asks \`t\` from \`${messagesId}\` for a key this build cannot read. That export ` +
            `names every message, so the catalogue ships whole and no pass can say which of ` +
            `its messages are asked for. Nothing was reported as unused.\n` +
            `  Import the message itself where the key is known — ` +
            `\`import { ${Object.keys(loaded.catalog)[0] ?? 'close'} } from '${messagesId}'\` — ` +
            `and a bundler ships that one string.`,
        );
        return;
      }

      for (const finding of unusedMessages(loaded.catalog, used, {
        filename: loaded.file,
        source: loaded.source,
        ignore: messages.ignore,
      })) {
        this.warn(formatDiagnostic(finding));
      }
    },
  };

  return [envPlugin, messagePlugin, templatePlugin, signalPlugin, serverPlugin, decoratorPlugin];
}

interface LoadedCatalog {
  file: string;
  source: string;
  catalog: MessageCatalog;
  /** Settled here so a tag nobody can format fails the build, not a page. */
  locale: string;
}

async function readCatalog(file: string, locale: string | undefined): Promise<LoadedCatalog> {
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    throw new Error(`[volt] messages catalogue "${file}" could not be read`);
  }

  let catalog: MessageCatalog;
  try {
    catalog = JSON.parse(source) as MessageCatalog;
  } catch (err) {
    throw new Error(`[volt] messages catalogue "${file}" is not valid JSON:\n${(err as Error).message}`);
  }
  // Before anything reads it: a shape the generator cannot compile is a
  // message that renders as nothing, and refusing it at the read means the
  // build stops on the catalogue rather than on the page that used it.
  checkCatalog(catalog, { catalogFile: file });

  return { file, source, catalog, locale: locale ?? localeFromPath(file) };
}

/**
 * `messages/de-DE.json` is written in `de-DE`, which is the whole convention.
 *
 * A name that is not a language tag is refused rather than guessed at.
 * `messages.json` would otherwise derive the tag `messages`, which is a
 * structurally legal subtag `Intl` accepts and silently formats nothing the
 * way the catalogue intends — a page in the wrong locale with nothing to
 * show for it. Two letters, or three, or say it outright.
 */
function localeFromPath(file: string): string {
  const derived = basename(file).replace(/\.[^.]+$/, '');
  let canonical = false;
  try {
    canonical = /^[A-Za-z]{2,3}(-|$)/.test(derived) && Intl.getCanonicalLocales(derived).length > 0;
  } catch {
    canonical = false;
  }
  if (!canonical) {
    throw new Error(
      `[volt] cannot tell what locale "${file}" is written in. Name it after its ` +
        'language tag — `messages/de-DE.json` — or set `messages.locale`.',
    );
  }
  return derived;
}

/** A key written out at the call, which is the only kind anything here can read. */
const KEY_ARGUMENT = /^(['"`])((?:[^'"`\\]|\\.)*)\1/;

/**
 * What a module does with the generated `t`, which names every message.
 *
 * Two questions, and one scan answers both because they have one subject. The
 * keys such a call asks for, which the plain scan beside this cannot see once
 * the import renamed it. And whether any call asks for a key this pass cannot
 * read — the dynamic-key path, where the argument is an expression and no
 * amount of scanning will say which message it selects.
 *
 * Lexical, like the key scan: the plugin sees a module's source before
 * anything has parsed it, and growing a TypeScript parser here would be the
 * dependency the compiler is written to avoid. The bias is the same and for
 * the same reason — a quoted import in a comment counts, and over-reading
 * costs a report nobody was told about, while under-reading names messages
 * that are used.
 *
 * A namespace import is the same fact written differently. A re-export is
 * read as unreadable rather than followed: it hands every message to a module
 * that imports from *here* and so never mentions the catalogue at all, which
 * is the one shape this scan cannot see coming.
 */
function catalogueCalls(
  source: string,
  moduleId: string,
): { keys: string[]; unreadable: boolean; imported: boolean } {
  const specifier = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const statement = new RegExp(
    `(?:^|[;}\\n])\\s*(import|export)\\s+([\\s\\S]*?)\\s+from\\s*['"\`]${specifier}['"\`]`,
    'g',
  );

  const keys: string[] = [];
  let unreadable = false;
  /**
   * Whether the module took `t` at all, which is a fact about the bundle and
   * not about the keys: `t` names every message, so linking it links them all
   * however few of them the calls below turn out to ask for.
   */
  let imported = false;
  /** How a call through each binding is spelled, as a source pattern. */
  const callees: string[] = [];

  for (const match of source.matchAll(statement)) {
    const clause = match[2]!;
    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) {
      imported = true;
      callees.push(`${namespace[1]!}\\s*\\.\\s*t`);
      continue;
    }
    const named = clause.match(/\{([\s\S]*)\}/);
    if (!named) continue;
    for (const binding of named[1]!.split(',')) {
      // `t` is the exported name, whatever the importer calls it locally, so
      // only the left of an `as` decides which export this is.
      const [exported, local] = binding.split(/\bas\b/).map((part) => part.trim());
      if (exported !== 't') continue;
      imported = true;
      if (match[1] === 'export') unreadable = true;
      else callees.push(local || exported);
    }
  }

  for (const callee of callees) {
    const opening = new RegExp(`(?<![\\w$.])${callee}\\s*\\(\\s*`, 'g');
    for (const call of source.matchAll(opening)) {
      const key = KEY_ARGUMENT.exec(source.slice(call.index + call[0].length));
      if (key) keys.push(key[2]!);
      else unreadable = true;
    }
  }

  return { keys, unreadable, imported };
}

export default volt;

// ---------------------------------------------------------------------------
// Template precompilation
// ---------------------------------------------------------------------------

interface TemplateSite {
  /** Range covering the whole `templateUrl:` property. */
  start: number;
  end: number;
  /** Path to the `.html` file, relative to the declaring module. */
  path: string;
}

interface StyleSite {
  start: number;
  end: number;
  /** One or more paths to `.scss` files. */
  paths: string[];
}

/** Everything the transform needs from the plugin that is running it. */
interface TemplateBuild {
  /** Which emit these templates get; see `targetFor`. */
  target: CodegenTarget;
  /** Only when a project overrode it; see `runtimeFor`. */
  runtimeModule: string | undefined;
  debug: boolean;
  groupRowBindings: boolean;
  a11y: A11ySeverity | undefined;
  catalog: MessageCatalog | undefined;
  catalogFile: string | undefined;
  /** Which spellings of `t` are the locale's; see `VoltMessagesOptions.translate`. */
  translate: readonly string[] | undefined;
  /** Registering a file makes an edit to it re-run this transform. */
  watch: (file: string) => void;
  /** Where a finding the compiler is not certain enough about to throw goes. */
  warn: (message: string) => void;
  /** A message key this template asked for, for the unused-message report. */
  use: (key: string) => void;
}

/**
 * Replace every template in a `@Component({...})` with a compiled `render`,
 * and inline any `styleUrl`/`styleUrls` files.
 *
 * Sites are located by scanning tokens rather than matching source patterns,
 * so a backtick inside a string, a comment mentioning `template:`, or a nested
 * object literal cannot produce a false hit.
 */
async function compileTemplates(
  code: string,
  id: string,
  build: TemplateBuild,
): Promise<{ code: string; map: null } | null> {
  const { target, runtimeModule, debug, groupRowBindings, a11y, catalog, catalogFile } = build;
  const { translate, watch, warn, use } = build;
  const templates = findTemplateSites(code);
  const styles = findStyleSites(code);
  if (templates.length === 0 && styles.length === 0) return null;

  const dir = dirname(id.split('?')[0] ?? id);
  const preamble: string[] = [];

  interface Replacement {
    start: number;
    end: number;
    text: string;
  }
  const edits: Replacement[] = [];
  let index = 0;

  for (const site of templates) {
    const file = resolvePath(dir, site.path);
    await assertExactCase(file, site.path, id);
    // Registering the file makes an edit to the markup re-run this transform,
    // so templates hot-reload like any other source file.
    watch(file);

    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      throw new Error(
        `[volt] templateUrl "${site.path}" could not be read (resolved to ${file}), referenced by ${id}`,
      );
    }

    const result = compile(source, {
      filename: file,
      runtime: RUNTIME_NAMESPACE,
      runtimeModule,
      target,
      groupRowBindings,
      a11y,
      catalog,
      catalogFile,
      translate,
    });

    for (const key of result.messageKeys) use(key);

    // The half of the accessibility pass that does not refuse the build. It
    // reaches a person here or nowhere: nothing else in a real build reads it,
    // and a diagnostic nobody sees is a rule nobody has.
    for (const warning of result.warnings) warn(formatDiagnostic(warning));

    if (debug) {
      const { stats } = result;
      console.info(
        `[volt] ${id}: ${stats.templates} template(s), ${stats.effects} effect(s), ` +
          `${stats.foldedBindings} binding(s) folded, ` +
          `${stats.delegatedEvents} event(s) delegated, ` +
          `${stats.dedupedTemplates} markup dedupe(s)`,
      );
    }

    const renderName = `__volt_render_${index++}`;
    preamble.push(...result.hoisted);
    // Params and body rather than one expression: a server emit is statements
    // writing into the writer it takes as its second parameter, and there is
    // nothing to return.
    preamble.push(
      `function ${renderName}(${result.renderParams}) {\n${indentBody(result.renderBody)}\n}`,
    );
    // The compiler's answer travels with the render it belongs to, so a
    // route can be asked whether its page has anything to attach without
    // anyone re-deriving it from the markup.
    edits.push({
      start: site.start,
      end: site.end,
      text: `render: ${renderName}, needsHydration: ${result.needsHydration}`,
    });
  }

  for (const site of styles) {
    const collected: string[] = [];
    for (const relative of site.paths) {
      if (!/\.s[ac]ss$/.test(relative)) {
        throw new Error(
          `[volt] styleUrl "${relative}" must be a .scss file (referenced by ${id}). ` +
            'Volt compiles Sass; plain .css is not a supported input.',
        );
      }

      const file = resolvePath(dir, relative);
      await assertExactCase(file, relative, id);
      watch(file);

      let source: string;
      try {
        source = await readFile(file, 'utf8');
      } catch {
        throw new Error(
          `[volt] styleUrl "${relative}" could not be read (resolved to ${file}), referenced by ${id}`,
        );
      }

      try {
        const compiled = await compileStringAsync(source, {
          syntax: relative.endsWith('.sass') ? 'indented' : 'scss',
          // Resolve @use/@import relative to the stylesheet itself.
          loadPaths: [dirname(file)],
          style: 'compressed',
        });
        // Anything the stylesheet pulls in must invalidate this module too.
        for (const url of compiled.loadedUrls) {
          if (url.protocol === 'file:') watch(fileURLToPath(url));
        }
        collected.push(compiled.css);
      } catch (err) {
        throw new Error(
          `[volt] Failed to compile ${file}:\n${(err as Error).message}`,
        );
      }
    }
    edits.push({
      start: site.start,
      end: site.end,
      text: `styles: ${JSON.stringify(collected.join('\n'))}`,
    });
  }

  edits.sort((a, b) => a.start - b.start);

  let output = '';
  let cursor = 0;
  for (const edit of edits) {
    output += code.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  output += code.slice(cursor);

  const header =
    preamble.length > 0
      ? `import * as ${RUNTIME_NAMESPACE} from ${JSON.stringify(runtimeModule ?? defaultRuntime(target))};\n` +
        preamble.join('\n') +
        '\n'
      : '';

  return { code: header + output, map: null };
}

/**
 * Fail when a path differs from the file on disk only by case.
 *
 * macOS and Windows resolve `./Counter.html` against `counter.html` without
 * complaint, so the mismatch survives every local build and every review, then
 * breaks the first Linux CI run or container deploy. Reading the directory and
 * comparing exactly is the only way to catch it on the machine where the
 * mistake is made.
 */
const caseChecked = new Set<string>();

async function assertExactCase(file: string, written: string, id: string): Promise<void> {
  if (caseChecked.has(file)) return;

  const directory = dirname(file);
  const wanted = file.slice(directory.length + 1);

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // A missing directory is reported by the read that follows, with a better
    // message than anything this function could give.
    return;
  }

  if (entries.includes(wanted)) {
    caseChecked.add(file);
    return;
  }

  const actual = entries.find((entry) => entry.toLowerCase() === wanted.toLowerCase());
  if (!actual) return;

  throw new Error(
    `[volt] "${written}" is spelled differently on disk: the file is "${actual}".\n` +
      `  Referenced by ${id}.\n` +
      '  This resolves on a case-insensitive filesystem and fails on Linux, so it is an\n' +
      '  error everywhere rather than a surprise at deploy time.',
  );
}

/**
 * Scan for `templateUrl:` properties inside a `@Component(` call, ignoring
 * anything in a comment, a string, or an unrelated object literal.
 */
function findTemplateSites(code: string): TemplateSite[] {
  const sites: TemplateSite[] = [];

  scanComponentProperties(code, (name, start, valueStart) => {
    if (name !== 'templateUrl') return null;
    const quote = code[valueStart];
    if (quote !== '"' && quote !== "'") return null;
    const end = skipQuoted(code, valueStart, quote);
    sites.push({ start, end, path: code.slice(valueStart + 1, end - 1) });
    return end;
  });

  return sites;
}

/** Scan for `styleUrl:` / `styleUrls:` inside a `@Component(` call. */
function findStyleSites(code: string): StyleSite[] {
  const sites: StyleSite[] = [];

  scanComponentProperties(code, (name, start, valueStart) => {
    if (name !== 'styleUrl' && name !== 'styleUrls') return null;

    const quote = code[valueStart];
    if (quote === '"' || quote === "'") {
      const end = skipQuoted(code, valueStart, quote);
      sites.push({ start, end, paths: [code.slice(valueStart + 1, end - 1)] });
      return end;
    }

    if (quote === '[') {
      const end = matchDelimiter(code, valueStart);
      const inner = code.slice(valueStart + 1, end - 1);
      const paths = [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      if (paths.length === 0) return null;
      sites.push({ start, end, paths });
      return end;
    }

    return null;
  });

  return sites;
}

/**
 * Walk `code`, invoking `onProperty` for each `name:` found directly inside a
 * `@Component(` argument. The callback returns the index to resume from when
 * it consumed the value, or null to skip.
 */
function scanComponentProperties(
  code: string,
  onProperty: (name: string, start: number, valueStart: number) => number | null,
): void {
  let i = 0;
  let componentDepth = -1;
  let depth = 0;

  while (i < code.length) {
    const ch = code[i]!;

    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }

    if (ch === '@' && code.startsWith('@Component', i) && !isIdentChar(code[i + 10] ?? '')) {
      const paren = code.indexOf('(', i + 10);
      if (paren !== -1) {
        componentDepth = depth;
        i = paren + 1;
        depth++;
        continue;
      }
    }

    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (componentDepth !== -1 && depth <= componentDepth) componentDepth = -1;
      i++;
      continue;
    }

    if (componentDepth !== -1 && /[A-Za-z_$]/.test(ch) && !isIdentChar(code[i - 1] ?? ' ')) {
      let j = i;
      while (j < code.length && isIdentChar(code[j]!)) j++;
      const name = code.slice(i, j);

      let k = j;
      while (k < code.length && /\s/.test(code[k]!)) k++;
      if (code[k] === ':') {
        k++;
        while (k < code.length && /\s/.test(code[k]!)) k++;
        const resume = onProperty(name, i, k);
        if (resume !== null) {
          i = resume;
          continue;
        }
      }
      i = j;
      continue;
    }

    i++;
  }
}

export { compile, CompilerError };

/**
 * The build check that nothing a render can reach imports a `node:` builtin.
 *
 * A plugin rather than part of `volt()`, because it is a policy and not a
 * compilation step: a project that only ever runs on Node has nothing to gain
 * from it, and a project deploying to an edge runtime cannot ship without it.
 * Ordered `pre` so it reads the `@Server()` boundary before the pass that
 * erases it.
 */
export { renderPath, isNodeBuiltin, type RenderPathOptions } from './render-path.js';

/**
 * The two virtual modules `start` serves, by the names an application imports.
 *
 * Exported so a project can name them in its own entry — the server half in a
 * deployment adapter, the client half in the shell's `<script>` — without
 * hard-coding a string this file could change.
 */
export { SERVER_ID as START_SERVER, CLIENT_ID as START_CLIENT, type StartOptions } from './start.js';
