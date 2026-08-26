/**
 * What a server render registers and never runs.
 *
 * A server drains render and data and stops, so a user or measure effect is
 * declared and never runs. That is correct — the work needs a browser — and it
 * is also the one way a component behaves differently on the two sides with
 * nothing to read that says so.
 *
 * It is a record and not a warning, and the tests below are written to hold
 * that decision rather than merely to pass: a diagnostic that fired on every
 * `effect` in every component on every server render would be one a project
 * filters instead of reading, so the assertions are about what is collected
 * and about what a production build collects, which is nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import {
  createRoot,
  createRequestScope,
  effect,
  measureEffect,
  runInRequest,
  serverSkippedEffects,
} from '../src/index.js';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

afterEach(() => serverBuild(false));

/** One request, so what is collected belongs to it and not to the process. */
function render(body: () => void): ReturnType<typeof serverSkippedEffects> {
  const scope = createRequestScope();
  let collected: ReturnType<typeof serverSkippedEffects> = [];
  runInRequest(scope, () => {
    createRoot(() => body());
    collected = serverSkippedEffects();
  });
  return collected;
}

describe('a server render', () => {
  it('records the user effect it will not run', () => {
    serverBuild(true);
    const skipped = render(() => {
      effect(() => undefined);
    });

    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.lane).toBe('user');
    expect(skipped[0]!.count).toBe(1);
    // The frame, so a reader can go to the line rather than guess at it.
    expect(skipped[0]!.site).not.toBe('(unknown)');
    expect(skipped[0]!.site).toContain('skipped.test.ts');
  });

  it('records a measure effect as a different lane', () => {
    serverBuild(true);
    const skipped = render(() => {
      measureEffect(() => undefined);
    });

    expect(skipped.map((entry) => entry.lane)).toEqual(['measure']);
  });

  it('counts a list rather than listing it a thousand times', () => {
    serverBuild(true);
    const skipped = render(() => {
      for (let i = 0; i < 50; i++) declaresOne();
    });

    // One entry, because it is one place in the source. A record with an entry
    // per row would be a record nobody reads, which is the same failure as a
    // warning per row.
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.count).toBe(50);
  });

  it('keeps one request’s record out of the next one’s', () => {
    serverBuild(true);
    render(() => {
      effect(() => undefined);
    });
    const second = render(() => undefined);

    // A server has one process and many requests. A module-level list would
    // hand every request every earlier request's effects.
    expect(second).toEqual([]);
  });
});

describe('a client build', () => {
  it('records nothing, because it runs the work', () => {
    serverBuild(false);
    const scope = createRequestScope();
    let collected: ReturnType<typeof serverSkippedEffects> = [];
    runInRequest(scope, () => {
      createRoot(() => {
        effect(() => undefined);
        measureEffect(() => undefined);
      });
      collected = serverSkippedEffects();
    });

    expect(collected).toEqual([]);
  });
});

/** A second frame, so "one place" means the source and not the call. */
function declaresOne(): void {
  effect(() => undefined);
}

describe('production build', () => {
  const root = resolve(import.meta.dirname, '../../..');

  async function bundle(dev: boolean): Promise<string> {
    const result = await build({
      stdin: {
        contents:
          "import { effect, measureEffect, serverSkippedEffects } from '@voltdev/reactivity';\n" +
          'globalThis.app = { effect, measureEffect, serverSkippedEffects };',
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'esnext',
      minify: true,
      alias: { '@voltdev/reactivity': resolve(root, 'packages/reactivity/src/index.ts') },
      define: { __VOLT_DEV__: String(dev), __VOLT_SERVER__: 'false' },
    });
    return result.outputFiles[0]!.text;
  }

  it('carries none of the record, since it is a development one', async () => {
    const bytes = await bundle(false);
    // Property names and string literals survive minification; local names do
    // not, so asserting on those would pass for the wrong reason.
    // Strings unique to the record. `measure` is deliberately not one of them:
    // it is a lane name the scheduler carries in every build, and asserting on
    // it would fail for a reason that has nothing to do with this.
    expect(bytes).not.toContain('volt.skipped');
    expect(bytes).not.toContain('(unknown)');
  });

  it('does carry it in a development build, so the absence above means something', async () => {
    const bytes = await bundle(true);
    expect(bytes).toContain('volt.skipped');
  });
});
