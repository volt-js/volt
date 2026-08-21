/**
 * `__VOLT_BUILD__` — the identity of the compiler that produced a page.
 *
 * Server rendering fails silently when the markup was printed by one build and
 * hydrated by another: the paths still resolve, they just land on the wrong
 * nodes. Nothing on the page can detect that, because bindings write rather
 * than compare. So the boot record carries this hash, and a client whose own
 * hash differs discards the server's tree and renders from scratch — one
 * comparison, before anything is claimed.
 *
 * It covers the compiler version and every option that can change what the
 * compiler emits, parser options included: `whitespace` and `comments` move
 * real bytes, and a guard that ignored them would pass on exactly the skew it
 * exists to catch. `filename` is deliberately not covered — it varies per
 * template, and this identifies a build.
 */

/**
 * Must match the `version` field of this package's `package.json`; a test
 * asserts it, because a hash that keeps saying "same build" across a compiler
 * upgrade is worse than no hash.
 */
export const COMPILER_VERSION = '0.1.0-alpha.1';

export interface BuildOptions {
  whitespace?: 'condense' | 'preserve';
  comments?: boolean;
  runtime?: string;
  ctx?: string;
  runtimeModule?: string;
  groupRowBindings?: boolean;
}

/**
 * The effective value of every covered option.
 *
 * Typed as a total record so adding an option to `BuildOptions` without
 * deciding its default is a type error rather than a hash that quietly stops
 * distinguishing two builds. Exported for the test that checks these keys
 * against the options the compiler actually reads, which is the only thing
 * that catches an option added to the compiler and forgotten here.
 */
export const DEFAULTS: Required<BuildOptions> = {
  whitespace: 'condense',
  comments: false,
  runtime: '_rt',
  ctx: '_ctx',
  runtimeModule: '@voltdev/core/runtime',
  groupRowBindings: false,
};

/**
 * FNV-1a, 32 bits, base36.
 *
 * The threat is a stale bundle, not a forged one, so this needs to be stable
 * and dependency-free rather than cryptographic — `node:crypto` is not
 * reachable from the two other places this compiler runs, a browser and an
 * edge worker.
 */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/**
 * The hash a compiler of `version` would produce.
 *
 * Split out for the test that an upgrade moves the hash: with the version
 * baked in there is no way to observe from outside that it is covered at all,
 * and a hash that drops it still answers every other question correctly while
 * telling two different compilers they are the same build.
 */
export function buildHashFor(version: string, options: BuildOptions = {}): string {
  const parts = [`v=${version}`];
  for (const key of Object.keys(DEFAULTS).sort() as (keyof BuildOptions)[]) {
    const value = options[key] ?? DEFAULTS[key];
    parts.push(`${key}=${JSON.stringify(value)}`);
  }
  return hash(parts.join(';'));
}

export function buildHash(options: BuildOptions = {}): string {
  return buildHashFor(COMPILER_VERSION, options);
}
