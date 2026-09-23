/**
 * `vite build` for a project that server-renders: two builds, client first.
 *
 * The order is the whole design. The server's shell is the client build's
 * emitted `index.html` — the one whose module script is the hashed asset in
 * `dist`, not the `/src/main.ts` of the source — and the identity the server
 * writes onto a page is a hash over what the client build emitted. Neither
 * exists until the client has been built, so the server is built after it and
 * handed both.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve as resolvePath } from 'node:path';
import type { Rolldown, UserConfig } from 'vite';

/**
 * Where the two builds go, and what makes `vite build` run both.
 *
 * Under the project's own `build.outDir` rather than in it: the client in
 * `client/`, which is what a host serves as files, and the server in
 * `server/`, which it must not. The server bundle holds every `@Server()` body
 * the client build was made not to have, and written beside the client's
 * assets it would be published with them. Said for every command, not only
 * `build`, because `vite preview` serves whatever the client's directory is
 * and answers everything else with what is in the server's.
 *
 * `builder: {}` is what makes the CLI's `vite build` a build of every
 * environment rather than of the client alone. The server bundle keeps no
 * dependency external, because an edge runtime has no `node_modules` to
 * resolve one from; a builtin is still left as an import, which is what the
 * separate `renderPath` check is there to refuse on a render path. A dev
 * server leaves its dependencies to Node, which is what makes it start fast —
 * all but Volt's own, which every server environment compiles (see `volt:env`).
 */
export function buildConfig(user: UserConfig, entry: string, building: boolean): UserConfig {
  const out = user.build?.outDir ?? 'dist';
  const client = { build: { outDir: join(out, 'client') } };
  const server = { build: { outDir: join(out, 'server') } };
  if (!building) return { environments: { client, ssr: server } };
  return {
    builder: {},
    environments: {
      client,
      ssr: {
        build: {
          ...server.build,
          ssr: join(resolvePath(user.root ?? '.'), entry),
          // `public/` is the client's, and the client build copied it already.
          // Copied again here, it is deployed with the server, where nothing
          // serves it.
          copyPublicDir: false,
        },
        resolve: { noExternal: true },
      },
    },
  };
}

/**
 * Where the server build wrote the entry, given the directory it wrote into.
 *
 * Vite names it after the entry, with `.js` in a project whose `package.json`
 * says `"type": "module"` and `.mjs` in one that does not, so that Node loads
 * it as a module either way. Both are looked for rather than the rule being
 * restated here; null when neither is there, which is a project not built.
 */
export function builtEntry(directory: string, entry: string): string | null {
  const name = basename(entry, extname(entry));
  for (const extension of ['.js', '.mjs']) {
    const file = join(directory, name + extension);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * Take the page out of a client bundle; its text, or null when there is none.
 *
 * Taken rather than read, so the page is never written among the client's
 * files. It is the shell every response is written into, and it goes into the
 * server bundle. Left beside the assets it is a file a host that serves files
 * first — most of them — sends for `/` as it stands, with an empty mount
 * point, and the handler never hears of the request.
 */
export function takePage(bundle: Rolldown.OutputBundle): string | null {
  const page = bundle['index.html'];
  if (page?.type !== 'asset') return null;
  delete bundle['index.html'];
  return typeof page.source === 'string' ? page.source : new TextDecoder().decode(page.source);
}

/**
 * The identity of a build: the compiler's hash, then one over what was built.
 *
 * The compiler's half alone identifies a compiler and its options, not a
 * deploy — two deploys with different templates on the same compiler carry
 * the same one, and a client cached from the first would claim the second's
 * markup with the first's paths. The second half is what makes the pair name
 * a build. The compiler's half is kept, first, so a mismatch says which of the
 * two moved.
 */
function identity(compiler: string, built: string): string {
  return `${compiler}.${built}`;
}

/** Eight hex characters, the length both kinds of second half share. */
const PART = 8;

/**
 * What the client module compares against while it is being built.
 *
 * The client's identity is a hash over the client's own code, which contains
 * the identity — so the code is hashed with this in its place, and this is
 * replaced by the answer afterwards. The same length as a real identity, so
 * no position in the chunk or its source map moves, and never one: `x` is not
 * a hex digit.
 */
export function pendingIdentity(compiler: string): string {
  return identity(compiler, 'x'.repeat(PART));
}

/**
 * One dev server's identity.
 *
 * Per session rather than per content, because a dev server's content changes
 * with every edit and there is no one moment at which it has been built. A
 * page printed before a restart is from a build that no longer exists, so a
 * client after the restart builds its page again rather than claiming it.
 */
export function sessionIdentity(compiler: string): string {
  return identity(compiler, randomBytes(PART / 2).toString('hex'));
}

/**
 * Settle a client bundle's identity and write it into the bundle.
 *
 * Over the code of every chunk, by file name, because the code is what lays
 * out the nodes a client claims: a template edit is a code edit, and nothing
 * else in the bundle — a stylesheet, a source map, the page's own HTML —
 * moves a node. Paths on the machine that built it are in none of it, so two
 * machines building one commit agree.
 */
export function settleIdentity(compiler: string, bundle: Rolldown.OutputBundle): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(bundle).sort()) {
    const file = bundle[name]!;
    if (file.type === 'chunk') hash.update(name).update('\0').update(file.code).update('\0');
  }
  const settled = identity(compiler, hash.digest('hex').slice(0, PART));
  const pending = pendingIdentity(compiler);
  for (const file of Object.values(bundle)) {
    if (file.type === 'chunk' && file.code.includes(pending)) {
      file.code = file.code.replaceAll(pending, settled);
    }
  }
  return settled;
}
