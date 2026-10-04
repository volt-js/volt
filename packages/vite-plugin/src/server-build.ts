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
import { basename, extname, join, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Logger, Rolldown, UserConfig, ViteBuilder } from 'vite';
import { PAGES_REGISTRY, SERVER_ID } from './server-render.js';
import {
  prerender,
  PrerenderError,
  type ParamsForPattern,
  type PrerenderedPage,
  type RenderMode,
  type RouteBranchLike,
} from './ssg.js';

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

/**
 * A built server bundle, started for the build: its table, a path's page —
 * null where the route that answers the path is not `ssg` — and the end of
 * everything it started.
 */
interface BuiltPages {
  readonly branches: readonly RouteBranchLike[];
  render(pathname: string): Promise<{ status: number; html: string } | null>;
  close(): Promise<void>;
}

export interface StaticPagesOptions {
  /** The project root, which the pages are named relative to when written. */
  root: string;
  /** The server build's directory, and the entry it was built from. */
  server: string;
  entry: string;
  /** What the server build answered with, which names the chunk each module went into. */
  built: Awaited<ReturnType<ViteBuilder['build']>>;
  /** The client build's directory: what a host serves as files, so where the pages go. */
  client: string;
  defaultMode: RenderMode;
  params?: ParamsForPattern | undefined;
  logger: Logger;
}

/**
 * Write every `ssg` page into the client's directory, through the server
 * that was just built.
 *
 * After both builds and not during either, because the page is the built
 * handler's answer — the shell with the hashed assets in it, this build's
 * mark, the path's, the state payload, the loader answers, the styles — and
 * that handler exists once the server build has written it. Rendered through
 * the bundle a host will run rather than through the source, so the file is
 * the bytes the handler would send for the path and nothing else: a host that
 * serves files first answers the path with the file, the handler answers
 * whoever asks a host that does not, and a client claims either.
 *
 * Each page goes where a static host serves its path from without being told
 * anything: `index.html` for `/`, and `about.html` for `/about`. Cloudflare,
 * Netlify and GitHub Pages serve `about.html` at `/about` as they find it.
 * `about/index.html` they serve at `/about/`, and they answer `/about` with a
 * redirect there — after which the address bar names a path the page was not
 * rendered for, and the client builds the page again rather than claiming
 * it. A host that serves neither at `/about` hands the request to the
 * handler, which answers it with the same bytes.
 *
 * A pattern with a parameter is written for what `params` answers, and one
 * with a required parameter it says nothing about fails the build: a page
 * left unwritten with no word said is one the handler renders for whoever
 * asks, and nobody would know. An empty list is something said — a section
 * with no pages yet — and writes none beyond the path a pattern has with its
 * optional parameters left out.
 */
export async function writeStaticPages(
  options: StaticPagesOptions,
): Promise<readonly PrerenderedPage[]> {
  const pages = await builtPages(options.server, options.entry, options.built);

  // Which patterns `params` answered at all. The enumerator skips a pattern
  // answered with no pages as it skips one not answered, and only the second
  // is a pattern nobody said anything about. Only a list is an answer: a
  // configuration in JavaScript says nothing with `null` as readily as with
  // `undefined`.
  const answered = new Set<string>();
  const given = options.params;
  const params: ParamsForPattern | undefined = given
    ? async (route) => {
        const values = await given(route);
        if (Array.isArray(values)) answered.add(route.id);
        return values;
      }
    : undefined;

  let written;
  try {
    written = await prerender({
      branches: pages.branches,
      outDir: options.client,
      defaultMode: options.defaultMode,
      params,
      layout: 'flat',
      render: (pathname) => renderPage(pages, pathname),
    });
  } catch (error) {
    // Every page was attempted, and each failure already says what it was;
    // the list of paths on top of them would say it again.
    if (error instanceof PrerenderError && error.failures.length > 0) {
      throw new Error(error.failures.map((failure) => messageOf(failure.cause)).join('\n\n'), {
        cause: error,
      });
    }
    throw error;
  } finally {
    await pages.close();
  }

  const unanswered = written.skipped.filter(
    (route) => route.reason === 'no-params' && !answered.has(route.id),
  );
  if (unanswered.length > 0) {
    throw new Error(
      unanswered
        .map(
          ({ pattern, id }) =>
            `[volt] ${pattern} renders as \`ssg\`, so its pages are written by the build, and a ` +
            'pattern with a parameter names no path on its own. Say which pages to write with ' +
            `\`serverRender.params\`: asked with { pattern: '${pattern}', id: '${id}' }, it ` +
            'answers with the parameters of each page, or with an empty list to write none and ' +
            "leave each to the handler — or give the route `mode: 'ssr'`, and it is rendered per " +
            'request.',
        )
        .join('\n\n'),
    );
  }

  for (const page of written.pages) {
    options.logger.info(`${relative(options.root, page.file)}  ${(page.bytes / 1000).toFixed(2)} kB`);
  }
  return written.pages;
}

/** What the server's thread says: first how it started, then each page it was asked for. */
type ThreadMessage =
  | { kind: 'table'; branches: RouteBranchLike[] }
  | { kind: 'unstartable'; message: string; where?: string }
  | { kind: 'none' }
  | { id: number; kind: 'page'; status: number; html: string }
  | { id: number; kind: 'other' }
  | { id: number; kind: 'failed'; message: string; where?: string };

/**
 * The thread the server bundle runs in while the build writes its pages.
 *
 * It puts a function where `serverModule` files its table, imports the
 * bundle, sends the table back — the parts of it the enumerator reads, since
 * a route's component and loader do not cross threads — and then renders
 * each path it is sent. Source rather than a file, because this module is
 * bundled into the plugin's own output and a file beside it would have to be
 * found again there.
 */
const PAGES_THREAD = `
const { parentPort, workerData } = require('node:worker_threads');
let filed;
globalThis[Symbol.for(${JSON.stringify(PAGES_REGISTRY)})] = (pages) => { filed = pages; };
const said = (error) => (error instanceof Error ? error.message : String(error));
// Where in the server it was thrown: the stack's frames, without the message
// \`said\` gives already. A message alone names a failure and not its line.
const where = (error) =>
  error instanceof Error && typeof error.stack === 'string'
    ? error.stack.split('\\n').filter((line) => /^\\s+at /.test(line)).join('\\n')
    : '';
import(workerData.url).then(
  () => {
    if (filed === undefined) return parentPort.postMessage({ kind: 'none' });
    const branches = filed.branches.map(({ segments, patterns, ids, routes }) => ({
      segments,
      patterns,
      ids,
      routes: routes.map(({ mode }) => ({ mode })),
    }));
    parentPort.postMessage({ kind: 'table', branches });
    parentPort.on('message', async ({ id, pathname }) => {
      try {
        const rendered = filed.render(pathname);
        if (rendered === null) return parentPort.postMessage({ id, kind: 'other' });
        const response = await rendered;
        const html = await response.text();
        parentPort.postMessage({ id, kind: 'page', status: response.status, html });
      } catch (error) {
        parentPort.postMessage({ id, kind: 'failed', message: said(error), where: where(error) });
      }
    });
  },
  (error) =>
    parentPort.postMessage({ kind: 'unstartable', message: said(error), where: where(error) }),
);
`;

/**
 * The server bundle in `directory`, started in a thread of its own.
 *
 * A thread, and not this process, because the bundle is the application's
 * server, and what a server starts as it loads — a timer that sweeps a cache,
 * a pool of connections — is meant to last as long as the process does. In
 * the build's process that is as long as `vite build` runs, and Vite ends a
 * build by having nothing left to run: one timer and it never ends. The
 * thread is ended once the pages are written, and all of that with it. It
 * also starts from Node's own loader, whatever loaded this plugin, and from
 * nothing an earlier build in the same process left behind.
 *
 * The chunk the generated module went into is the one imported, which is the
 * entry unless the entry imports the handler behind an `import()` — as one
 * that keeps a host's first request cheap does. That puts the module in a
 * chunk of its own, which importing the entry never evaluates.
 */
async function builtPages(
  directory: string,
  entry: string,
  built: StaticPagesOptions['built'],
): Promise<BuiltPages> {
  const outputs = Array.isArray(built) ? built : 'output' in built ? [built] : [];
  const chunk = outputs
    .flatMap(({ output }) => output)
    .find((file) => file.type === 'chunk' && file.moduleIds.includes(`\0${SERVER_ID}`));
  const file = chunk ? join(directory, chunk.fileName) : builtEntry(directory, entry);
  if (file === null) {
    throw new Error(
      `[volt] The server build wrote no ${entry} into ${directory}, and the \`ssg\` pages are ` +
        'rendered through it.',
    );
  }

  const thread = new Worker(PAGES_THREAD, {
    eval: true,
    workerData: { url: pathToFileURL(file).href },
  });
  const asked = new Map<number, (message: ThreadMessage) => void>();
  let started!: (message: ThreadMessage) => void;
  const start = new Promise<ThreadMessage>((resolve) => (started = resolve));
  // A thread that ends on its own — a throw nothing caught, or the server
  // calling `process.exit` — ends every answer still owed, and any asked for
  // after it, with what ended it.
  let ended: string | null = null;
  const end = (why: string): void => {
    ended ??= why;
    started({ kind: 'unstartable', message: ended });
    for (const answer of asked.values()) answer({ id: -1, kind: 'failed', message: ended });
    asked.clear();
  };
  thread.on('message', (message: ThreadMessage) => {
    if (!('id' in message)) return started(message);
    asked.get(message.id)?.(message);
    asked.delete(message.id);
  });
  thread.on('error', (error) => end(messageOf(error)));
  thread.on('exit', (code) => end(`the server's thread exited with code ${code}`));
  const close = async (): Promise<void> => {
    await thread.terminate();
  };

  const first = await start;
  if (first.kind === 'table') {
    let next = 0;
    return {
      branches: first.branches,
      async render(pathname) {
        const answer = await new Promise<ThreadMessage>((resolve) => {
          if (ended !== null) return resolve({ id: -1, kind: 'failed', message: ended });
          const id = next++;
          asked.set(id, resolve);
          thread.postMessage({ id, pathname });
        });
        if (answer.kind === 'failed') throw new ThreadError(answer.message, answer.where);
        return answer.kind === 'page' ? { status: answer.status, html: answer.html } : null;
      },
      close,
    };
  }
  await close();
  if (first.kind === 'unstartable') {
    // Started whether or not a route is `ssg`, because only the table in it
    // says — so a bundle that cannot start in Node fails every build, and the
    // build says why it was being started at all.
    throw new Error(
      `[volt] \`vite build\` imports the server it built, in Node, to find the \`ssg\` routes ` +
        `and write their pages through it, and importing ${file} failed: ${first.message}` +
        (first.where ? `\n${first.where}` : ''),
    );
  }
  throw new Error(
    `[volt] ${file} filed no pages when it was imported, so nothing in it imports ` +
      `${SERVER_ID}, and the \`ssg\` pages are rendered through that.`,
  );
}

/** One page's bytes, or what stopped them, said for whoever reads the build's output. */
async function renderPage(pages: BuiltPages, pathname: string): Promise<string> {
  let rendered;
  try {
    rendered = await pages.render(pathname);
  } catch (error) {
    const where = error instanceof ThreadError ? error.where : '';
    throw new Error(explainFailure(pathname, messageOf(error), where), { cause: error });
  }
  if (rendered === null) {
    // A parameter's value made the path one a more specific route answers,
    // and that route renders per request or in the browser. A file there
    // would be what a host serves in its place, to every reader.
    throw new Error(
      `[volt] ${pathname} was given as an \`ssg\` page by \`serverRender.params\`, and a request ` +
        'for it is answered by another route, which does not render as `ssg`. Leave the path out ' +
        'of what `params` answers, so a host hands it to the handler.',
    );
  }
  if (rendered.status !== 200) {
    // The handler's not-found page, which is a 404 from the handler and would
    // be a 200 from a host serving it as a file.
    throw new Error(
      `[volt] ${pathname} renders as \`ssg\`, and the handler answered ${rendered.status} for it, ` +
        'so there is no page to write: no route matches the address as a request spells it. A ' +
        'static segment is compared as it is written, so one a URL percent-encodes, such as ' +
        '`café`, matches no request.',
    );
  }
  return rendered.html;
}

/**
 * Why an `ssg` page could not be written, for a reader who wrote the route.
 *
 * The request such a page is rendered for is said here, because the commonest
 * failure is a loader whose guard wanted one: on an `ssr` route it read the
 * reader's cookies, and here there is no reader.
 */
function explainFailure(pathname: string, what: string, where = ''): string {
  return (
    `[volt] ${pathname} renders as \`ssg\`, so its page is written by the build, from a request ` +
    'with nothing of a reader\'s in it: no cookies, no headers. Writing it failed: ' +
    `${what}\n  A loader that needs the reader's request belongs on an \`ssr\` route, which is ` +
    'rendered per request.' +
    (where ? `\n${where}` : '')
  );
}

/**
 * A failure in the server's thread, and where in the server it was thrown.
 *
 * Only the message and the frames cross between threads, and the build's
 * error is made in this one, so its own stack is the build's. The frames go
 * into what the build says, which is the only place a reader looks.
 */
class ThreadError extends Error {
  readonly where: string;
  constructor(message: string, where = '') {
    super(message);
    this.where = where;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
