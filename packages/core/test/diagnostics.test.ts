/**
 * What an error still says after the prose has been stripped out of it.
 *
 * `__VOLT_DEV__` removes message text from a production build, and it used to
 * remove it from errors too — which left a `throw` that a correct program
 * depends on carrying nothing a report could group by. The split is that
 * `__VOLT_DEV__` gates the words and `__VOLT_DIAGNOSTICS__` gates the
 * structure, and the second is on in production.
 *
 * The claim is about what ships, so half of this is asserted on bundled,
 * minified bytes rather than on the source. A test that imported the module
 * and read `error.code` would pass on a build that shipped the whole
 * paragraph, which is the failure this exists to prevent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { VoltError, needsServerBuild, voltError } from '../src/diagnostics.js';

function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

beforeEach(() => serverBuild(false));
afterEach(() => serverBuild(false));

describe('an error in a build that kept its words', () => {
  it('carries the code, the detail and the place to look it up', () => {
    const error = voltError('V0101', { entry: 'renderToString' }, 'the long sentence');

    expect(error).toBeInstanceOf(VoltError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('V0101');
    expect(error.detail).toEqual({ entry: 'renderToString' });
    expect(error.docs).toBe('https://voltjs.dev/e/V0101');
  });

  it('puts the sentence in the message, since that is what a developer reads', () => {
    const error = needsServerBuild('renderToString');
    expect(error.message).toContain('needs a server build');
    expect(error.message).toContain('V0101');
  });

  it('falls back to the identity when the sentence has been stripped', () => {
    // `false` is exactly what `__VOLT_DEV__ && '…'` folds to. The message has
    // to stay worth reading at that point, because it is the only thing a log
    // pipeline that keeps `message` alone will have.
    const error = voltError('V0101', { entry: 'renderToString' }, false);

    expect(error.message).toContain('V0101');
    expect(error.message).toContain('entry=renderToString');
    expect(error.message).toContain('https://voltjs.dev/e/V0101');
    expect(error.message).not.toContain('needs a server build');
  });
});

describe('a build that turned the structure off as well', () => {
  /**
   * Re-import with the constant defined `false`.
   *
   * `DIAGNOSTICS` is read once at module scope, so the only way to see the
   * other branch is to evaluate the module again — which is what a build
   * defining `__VOLT_DIAGNOSTICS__: false` does at compile time. The class
   * that comes back is a different one from the one imported at the top of
   * this file, so nothing here uses `instanceof`.
   */
  async function withoutDiagnostics(): Promise<typeof voltError> {
    (globalThis as Record<string, unknown>)['__VOLT_DIAGNOSTICS__'] = false;
    vi.resetModules();
    const module = (await import('../src/diagnostics.js')) as { voltError: typeof voltError };
    return module.voltError;
  }

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['__VOLT_DIAGNOSTICS__'];
    vi.resetModules();
  });

  it('is left with the code and nothing else', async () => {
    const bare = await withoutDiagnostics();
    const error = bare('V0101', { entry: 'renderToString' }, 'the whole sentence');

    // The code stays, because an error that cannot be grouped is not worth
    // throwing distinctly. Everything that costs bytes goes.
    expect(error.message).toBe('[volt] V0101');
    expect(error.detail).toEqual({});
    expect(error.docs).toBe('');
  });

  it('drops the detail rather than keeping it behind an empty message', async () => {
    // The failure this guards against is subtle: leaving `detail` populated
    // while blanking the message keeps every identity string in the bundle,
    // which is the cost the option was turned off to avoid.
    const bare = await withoutDiagnostics();
    expect(bare('V0301', { tag: 'script' }, false).detail).toEqual({});
  });
});

describe('the public contract', () => {
  it('is reachable by name, since an application is meant to branch on it', async () => {
    // Duck-typing `.code` would work and would be a worse contract: an error a
    // consumer is expected to act on and cannot name is not one.
    // Both imported here rather than compared against the top of the file: a
    // suite above resets the module registry, so the class this file imported
    // at load time is not the one the registry holds now. Comparing two fresh
    // imports asks the question that matters — that the barrel re-exports the
    // same class the module defines — without depending on that.
    const core = (await import('@voltdev/core')) as { VoltError?: unknown };
    const module = (await import('../src/diagnostics.js')) as { VoltError: unknown };
    expect(core.VoltError).toBe(module.VoltError);
  });
});

describe('production build', () => {
  const root = resolve(import.meta.dirname, '../../..');

  /** An application entry, bundled and minified the way one is shipped. */
  async function bundle(dev: boolean): Promise<string> {
    const result = await build({
      stdin: {
        contents:
          "import { renderToString } from '@voltdev/core/server';\n" +
          'globalThis.app = { renderToString };',
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'esnext',
      minify: true,
      alias: {
        '@voltdev/reactivity/signals': resolve(root, 'packages/reactivity/src/signals.ts'),
        '@voltdev/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
        '@voltdev/compiler': resolve(root, 'packages/compiler/src/index.ts'),
        '@voltdev/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
        '@voltdev/core/server': resolve(root, 'packages/core/src/server.ts'),
        '@voltdev/core': resolve(root, 'packages/core/src/index.ts'),
      },
      define: { __VOLT_DEV__: String(dev), __VOLT_SERVER__: 'false' },
    });
    return result.outputFiles[0]!.text;
  }

  /** Sentences from three separate throw sites, all of them stripped. */
  const prose = [
    'needs a server build',
    'Templates are compiled for one side or the other',
    'which ends the element rather than appearing inside it',
  ];

  it('is not carrying the sentences', async () => {
    const bytes = await bundle(false);
    for (const sentence of prose) {
      expect(bytes, `production still ships: ${sentence}`).not.toContain(sentence);
    }
  });

  it('is still carrying the codes, which is the half that had to survive', async () => {
    const bytes = await bundle(false);
    // Without this the test above passes on a build that stripped the throw
    // itself, which is what the old single flag actually did.
    expect(bytes).toContain('V0101');
    expect(bytes).toContain('https://voltjs.dev/e/');
  });

  it('does carry the sentences in a development build', async () => {
    // The other side of the same assertion. A `not.toContain` alone would pass
    // against a bundler that had quietly stopped including the module at all.
    const bytes = await bundle(true);
    for (const sentence of prose) {
      expect(bytes, `development lost: ${sentence}`).toContain(sentence);
    }
  });
});
