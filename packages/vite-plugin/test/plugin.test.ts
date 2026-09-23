import { describe, expect, it } from 'vitest';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { resolve } from 'node:path';
import { volt } from '../src/index.js';
import { resolveConfig, type Plugin } from 'vite';

type TransformHook = (
  this: {
    error(message: string): never;
    warn(message: string): void;
    addWatchFile(file: string): void;
  },
  code: string,
  id: string,
) => Promise<{ code: string } | null> | { code: string } | null;

/** Files the plugin asked Vite to watch, so template edits hot-reload. */
let watched: string[] = [];

/** What the plugin reported without refusing the build. */
let warned: string[] = [];

/** A module living beside the fixtures, so relative paths resolve. */
const FIXTURE_ID = resolve(import.meta.dirname, 'fixtures/component.ts');

/** Invoke a plugin's transform hook with a minimal Rollup-ish context. */
async function runTransform(
  plugin: Plugin,
  code: string,
  id = FIXTURE_ID,
  environment?: { config?: { consumer?: 'client' | 'server' } },
): Promise<string | null> {
  const hook = plugin.transform as unknown as TransformHook;
  watched = [];
  warned = [];
  const context = {
    environment,
    error(message: string): never {
      throw new Error(message);
    },
    warn(message: string) {
      warned.push(message);
    },
    addWatchFile(file: string) {
      watched.push(file);
    },
  };
  const result = await hook.call(context, code, id);
  lastMap = result && 'map' in result ? (result.map as SourceMapPayload | null) : null;
  return result ? result.code : null;
}

/** The source map the last transform returned, if it returned one. */
let lastMap: SourceMapPayload | null = null;

function plugins(options?: Parameters<typeof volt>[0]) {
  const all = volt(options);
  const byName = (name: string) => all.find((p) => p.name === name)!;
  return { templates: byName('volt:templates'), decorators: byName('volt:decorators') };
}

const COMPONENT = `
import { Component, Signal } from '@voltdev/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
})
export class Counter {
  count = new Signal.State(0);
  inc() { this.count.set(this.count.get() + 1); }
}
`;

describe('template precompilation', () => {
  it('reads the html file and replaces templateUrl with a render function', async () => {
    const { templates } = plugins();
    const output = await runTransform(templates, COMPONENT);

    expect(output).not.toBeNull();
    expect(output).toContain('render: __volt_render_0');
    expect(output).not.toContain('templateUrl');
    // Static markup hoisted to module scope, parsed once per module.
    expect(output).toContain('__volt_rt.template("<button></button>")');
    expect(output).toContain('import * as __volt_rt from "@voltdev/core/runtime"');
    // The handler is delegated rather than bound per element.
    expect(output).toContain('__volt_rt.delegate');
  });

  it('maps what it emits back to the source, below the hoisted templates too', async () => {
    // The templates are hoisted above the class, so every line of the module
    // moves down. Without a map that says so, a stack trace, a breakpoint and
    // the dev server's overlay all point that many lines below the code that
    // ran.
    const { templates } = plugins();
    const output = (await runTransform(templates, COMPONENT))!;
    expect(lastMap, 'no source map').not.toBeNull();

    const line = (text: string): number => text.split('\n').findIndex((each) => each.includes('inc() {'));
    const emitted = line(output);
    const column = output.split('\n')[emitted]!.indexOf('inc() {');
    expect(emitted).toBeGreaterThan(line(COMPONENT));

    const map = new SourceMap(lastMap!);
    expect(map.findEntry(emitted, column)).toMatchObject({
      originalLine: line(COMPONENT),
      originalColumn: column,
    });

    // And what it hoisted is this module's too. Unmapped, it would be counted
    // by anything reading the map — a bundle analysis, a profiler — as part of
    // whatever module came before it.
    const render = output.split('\n').findIndex((each) => each.includes('function __volt_render_0'));
    expect(map.findEntry(render, 0)).toMatchObject({ originalLine: 0, originalColumn: 0 });
  });

  it('registers the html file so edits hot-reload', async () => {
    const { templates } = plugins();
    await runTransform(templates, COMPONENT);
    expect(watched.some((f) => f.endsWith('counter.html'))).toBe(true);
  });

  it('leaves files without a @Component alone', async () => {
    const { templates } = plugins();
    expect(await runTransform(templates, `export const x = 1;`)).toBeNull();
  });

  it('does nothing when precompilation is disabled', async () => {
    const { templates } = plugins({ precompileTemplates: false });
    expect(await runTransform(templates, COMPONENT)).toBeNull();
  });

  it('skips node_modules', async () => {
    const { templates } = plugins();
    const output = await runTransform(templates, COMPONENT, '/x/node_modules/pkg/index.ts');
    expect(output).toBeNull();
  });

  it('ignores templateUrl outside a @Component call', async () => {
    const source = `
      const config = { templateUrl: './counter.html' };
      export { config };
    `;
    const { templates } = plugins();
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('is not fooled by the word templateUrl in a string or comment', async () => {
    const source = `
      // templateUrl: './counter.html'
      const s = "templateUrl: './counter.html'";
      export { s };
    `;
    const { templates } = plugins();
    expect(await runTransform(templates, source)).toBeNull();
  });

  it('compiles several components in one module', async () => {
    const source = `
      @Component({ selector: 'v-a', templateUrl: './a.html' })
      export class A {}
      @Component({ selector: 'v-b', templateUrl: './b.html' })
      export class B {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);
    expect(output).toContain('render: __volt_render_0');
    expect(output).toContain('render: __volt_render_1');
  });

  it('fails with a useful message when the file is missing', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './nope.html' })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /templateUrl "\.\/nope\.html" could not be read/,
    );
  });

  it('reports an accessibility warning, which reaches a person here or nowhere', async () => {
    // The warning half of the compiler's accessibility pass is a judgement a
    // caller may disagree with, so it is returned rather than thrown — and a
    // returned diagnostic nobody prints is a rule nobody has.
    const source = `
      @Component({ selector: 'v-w', templateUrl: './unreachable.html' })
      export class W {}
    `;
    const { templates } = plugins();
    await runTransform(templates, source);
    expect(warned).toEqual([
      expect.stringMatching(/^\[volt:compiler\] `:click` on `<div>`[\s\S]*unreachable\.html:1:6\)$/),
    ]);
  });

  it('still reports the warnings an accessibility error cut the pass short of', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './no-alt.html' })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(/`<img>` with no `alt`/);
    expect(warned).toEqual([expect.stringContaining('`:click` on `<div>`')]);
  });

  it('builds anyway once the caller downgrades the rules, and still says everything', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './no-alt.html' })
      export class X {}
    `;
    const { templates } = plugins({ a11y: 'warn' });
    expect(await runTransform(templates, source)).toContain('render: __volt_render_0');
    expect(warned).toEqual([
      expect.stringContaining('`:click` on `<div>`'),
      expect.stringContaining('`<img>` with no `alt`'),
    ]);
  });

  it('says nothing when the rules are switched off', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './no-alt.html' })
      export class X {}
    `;
    const { templates } = plugins({ a11y: 'off' });
    expect(await runTransform(templates, source)).toContain('render: __volt_render_0');
    expect(warned).toEqual([]);
  });

  it('reports template syntax errors against the html file, not the component', async () => {
    const source = `
      @Component({ selector: 'v-x', templateUrl: './broken.html' })
      export class X {}
    `;
    const { templates } = plugins();
    // broken.html exists but has an unclosed tag, so this is a compiler error
    // rather than a missing-file error — and it must name the html file.
    await expect(runTransform(templates, source)).rejects.toThrow(
      /volt:compiler[\s\S]*broken\.html/,
    );
  });
});

describe('styleUrl / styleUrls', () => {
  it('compiles a stylesheet from Sass and flattens nesting', async () => {
    const source = `
      @Component({
        selector: 'v-greeting',
        templateUrl: './greeting.html',
        styleUrl: './greeting.scss',
      })
      export class Greeting {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);

    expect(output).not.toContain('styleUrl');
    // Nesting is resolved at build time, not shipped.
    expect(output).toContain('.greeting strong{font-weight:700}');
    // Compressed output, so the colour keyword is emitted as its short hex.
    expect(output).toContain('#639');
  });

  it('concatenates several stylesheets in order', async () => {
    const source = `
      @Component({
        selector: 'v-greeting',
        templateUrl: './greeting.html',
        styleUrls: ['./greeting.scss', './extra.scss'],
      })
      export class Greeting {}
    `;
    const { templates } = plugins();
    const output = await runTransform(templates, source);

    expect(output).toContain('#639');
    // Pulled in from the partial that extra.scss @uses.
    expect(output).toContain('#fafafa');
  });

  it('watches partials pulled in with @use, not just the entry file', async () => {
    const source = `
      @Component({
        selector: 'v-greeting',
        templateUrl: './greeting.html',
        styleUrl: './extra.scss',
      })
      export class Greeting {}
    `;
    const { templates } = plugins();
    await runTransform(templates, source);

    // Editing the partial has to invalidate the component too.
    expect(watched.some((f) => f.endsWith('extra.scss'))).toBe(true);
    expect(watched.some((f) => f.endsWith('_tokens.scss'))).toBe(true);
  });

  it('rejects a plain .css file', async () => {
    const source = `
      @Component({
        selector: 'v-x',
        templateUrl: './greeting.html',
        styleUrl: './greeting.css',
      })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /must be a \.scss file/,
    );
  });

  it('fails with a useful message when a stylesheet is missing', async () => {
    const source = `
      @Component({
        selector: 'v-x',
        templateUrl: './greeting.html',
        styleUrl: './nope.scss',
      })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /styleUrl "\.\/nope\.scss" could not be read/,
    );
  });

  it('reports Sass errors against the stylesheet', async () => {
    const source = `
      @Component({
        selector: 'v-x',
        templateUrl: './greeting.html',
        styleUrl: './broken.scss',
      })
      export class X {}
    `;
    const { templates } = plugins();
    await expect(runTransform(templates, source)).rejects.toThrow(
      /Failed to compile[\s\S]*broken\.scss/,
    );
  });
});

describe('decorator lowering', () => {
  it('removes standard decorator syntax', async () => {
    const { decorators } = plugins();
    const output = await runTransform(decorators, COMPONENT);

    expect(output).not.toBeNull();
    // No engine implements decorators yet, so none may survive the transform.
    expect(output).not.toMatch(/^\s*@Component/m);
  });

  it('leaves files with no decorators untouched', async () => {
    const { decorators } = plugins();
    expect(await runTransform(decorators, `export const x = 1;`)).toBeNull();
  });
});

describe('paths must match the file on disk exactly', () => {
  it('rejects a templateUrl that differs only by case', async () => {
    const { templates } = plugins();
    // Resolves happily on macOS and Windows, then breaks the first Linux CI
    // run — so it is an error on the machine where the mistake is made.
    await expect(
      runTransform(
        templates,
        `@Component({ selector: 'v-c', templateUrl: './Counter.html' })\nexport class C {}`,
      ),
    ).rejects.toThrow(/spelled differently on disk: the file is "counter\.html"/);
  });

  it('accepts the exact spelling', async () => {
    const { templates } = plugins();
    await expect(
      runTransform(
        templates,
        `@Component({ selector: 'v-c', templateUrl: './counter.html' })\nexport class C {}`,
      ),
    ).resolves.not.toBeNull();
  });
});

describe('the build flags', () => {
  type Env = { mode: string; command: 'build' | 'serve'; isSsrBuild?: boolean };
  type Environment = { consumer?: 'client' | 'server' };

  /**
   * What one environment of one build is compiled with.
   *
   * Both hooks, merged the way Vite merges them — the environment's `define`
   * over the root's — because the answer is only right as the pair.
   */
  function defines(name: string, env: Env, environment: Environment = {}) {
    const plugin = volt().find((p) => p.name === 'volt:env')!;
    const config = plugin.config as (config: object, env: Env) => { define: Record<string, string> };
    const perEnvironment = plugin.configEnvironment as (
      name: string,
      config: Environment,
      env: Env,
    ) => { define: Record<string, string> };
    return {
      ...config.call(plugin, {}, env).define,
      ...perEnvironment.call(plugin, name, environment, env).define,
    };
  }

  const build: Env = { mode: 'production', command: 'build' };
  const ssrBuild: Env = { mode: 'production', command: 'build', isSsrBuild: true };
  const serve: Env = { mode: 'development', command: 'serve' };

  it('marks the server environment as one, and the client environment as not', () => {
    expect(defines('ssr', ssrBuild).__VOLT_SERVER__).toBe('true');
    // The half a single `define` cannot express: the client modules of the
    // same build must not be compiled as a server build, or the pages it
    // serves are the ones that never queue `onMount`.
    expect(defines('client', ssrBuild).__VOLT_SERVER__).toBe('false');
  });

  it('marks the server side of a dev server too, where no build flag is set', () => {
    // `isSsrBuild` is Vite's answer for a build and is undefined on a dev
    // server — the mode an SSR application is developed in, and where a flag
    // read from it would leave every gate inert.
    expect(defines('ssr', serve).__VOLT_SERVER__).toBe('true');
    expect(defines('client', serve).__VOLT_SERVER__).toBe('false');
  });

  it('goes by what an environment consumes, not by its name', () => {
    expect(defines('edge', build, { consumer: 'server' }).__VOLT_SERVER__).toBe('true');
    expect(defines('worker', build, { consumer: 'client' }).__VOLT_SERVER__).toBe('false');
  });

  it('keeps error structure in a production build, where the words are stripped', () => {
    // The two halves of the old single flag, and the reason it was split: a
    // production build carries no sentences and still has to say which failure
    // this was, or a report groups every refusal in the framework together.
    const production = defines('client', build);
    expect(production.__VOLT_DEV__).toBe('false');
    expect(production.__VOLT_DIAGNOSTICS__).toBe('true');
  });

  it('lets a build that counts every byte turn the structure off too', () => {
    const plugin = volt({ diagnostics: false }).find((p) => p.name === 'volt:env')!;
    const config = plugin.config as (config: object, env: Env) => { define: Record<string, string> };
    expect(config.call(plugin, {}, build).define.__VOLT_DIAGNOSTICS__).toBe('false');
  });

  it('marks a plain client build as a client build', () => {
    expect(defines('client', build).__VOLT_SERVER__).toBe('false');
    expect(defines('client', { mode: 'development', command: 'build' }).__VOLT_DEV__).toBe('true');
  });

  /**
   * The hooks above, run by Vite rather than by this file.
   *
   * Calling a hook proves what it answers; only Vite proves that it is asked —
   * a per-environment `define` that Vite never merges is a flag every module
   * reads as `false`, and the unit tests above would still pass.
   */
  it('reaches both environments of a real config, on a dev server as much as a build', async () => {
    const inline = { configFile: false as const, logLevel: 'silent' as const, plugins: [volt()] };

    // A dev server has both environments whether or not the project asked for
    // them; a build has the server one only when the project ships a server.
    const resolved = {
      serve: await resolveConfig(inline, 'serve'),
      build: await resolveConfig({ ...inline, environments: { ssr: {} } }, 'build'),
    };

    for (const [command, config] of Object.entries(resolved)) {
      expect(config.environments.ssr!.define?.__VOLT_SERVER__, command).toBe('true');
      expect(config.environments.client!.define?.__VOLT_SERVER__, command).toBe('false');
    }
  });
});

describe('which emit a build gets', () => {
  /** The three are told apart by what the generated code calls. */
  const emitOf = (code: string): 'client' | 'server' | 'hydrate' =>
    code.includes('_rt.hClaim(') || code.includes('_rt.hClose(') || code.includes('_rt.hInsert(')
      ? 'hydrate'
      : code.includes('_o.raw(') || code.includes('_o.text(')
        ? 'server'
        : 'client';

  it('builds the page from nothing unless a project asks otherwise', async () => {
    const { templates } = plugins();
    const out = await runTransform(templates, COMPONENT);
    expect(emitOf(out!)).toBe('client');
  });

  it('claims the server’s nodes when the project asks for it', async () => {
    // The opt-in the roadmap requires: client rendering stays first-class, and
    // a project that never server-renders carries no second emit of anything.
    const { templates } = plugins({ hydrate: true });
    const out = await runTransform(templates, COMPONENT);
    expect(emitOf(out!)).toBe('hydrate');
  });

  it('claims them for a project in `serverRender`, which did not say so twice', async () => {
    // `serverRender` server-renders, so its client half has to attach to what
    // the server wrote. Making the project write `hydrate: true` beside
    // `serverRender: true` would be asking it to restate a decision it has
    // already made, and getting one of the two wrong produces a page that
    // builds a second copy on top of the first.
    const { templates } = plugins({ serverRender: true });
    const out = await runTransform(templates, COMPONENT);
    expect(emitOf(out!)).toBe('hydrate');
  });

  it('still builds from nothing for a serverRender project whose routes are all csr', async () => {
    // The escape hatch stays reachable: `hydrate` is only implied, so a
    // project that wants the wiring without the server rendering says so.
    const { templates } = plugins({ serverRender: true, hydrate: false });
    const out = await runTransform(templates, COMPONENT);
    expect(emitOf(out!)).toBe('client');
  });

  it('leaves the server environment alone, which has no use for either', async () => {
    const { templates } = plugins({ hydrate: true });
    const out = await runTransform(templates, COMPONENT, FIXTURE_ID, {
      config: { consumer: 'server' },
    });
    expect(emitOf(out!)).toBe('server');
  });

  it('hashes a hydrating client the same as the server it hydrates', async () => {
    // `target` is excused from `__VOLT_BUILD__` deliberately. If it were not,
    // the two builds would disagree and the client would discard every page
    // the server printed as stale.
    const hash = (code: string) => /__VOLT_BUILD__|buildHash[^\n]*/.exec(code)?.[0] ?? null;
    const { templates } = plugins({ hydrate: true });
    const client = await runTransform(templates, COMPONENT);
    const server = await runTransform(templates, COMPONENT, FIXTURE_ID, {
      config: { consumer: 'server' },
    });
    expect(hash(client!)).toEqual(hash(server!));
  });
});
