/**
 * `serverRender`: the wiring an application would otherwise write by hand.
 *
 * The router, the query cache, server rendering and server functions are each
 * a deliverable and each works; none of them is a way to begin. This mode puts
 * them together — and it is opt-in, because the roadmap's own position is that
 * CSR is first-class and server rendering is something an application chooses,
 * never the price of using the framework. A turnkey mode that quietly made
 * every project a server project would contradict that, so `serverRender` is
 * `false` until somebody writes `true`.
 *
 * **The wiring is generated into the application's own module graph**, as
 * virtual modules, rather than shipped as a package the application depends
 * on. Three reasons, and the third is the one that decided it:
 *
 *   - `@voltdev/server` is deliberately dependency-free — a `(Request) =>
 *     Response` and nothing else — and giving it the router and the renderer
 *     would end that.
 *   - A sixth package is the opposite of what the section this comes from is
 *     called.
 *   - The generated code imports `@voltdev/core/server` and `@voltdev/router`
 *     by name, so the *application's* build resolves them, at the versions the
 *     application has. A package would have pinned its own.
 *
 * What the application supplies is a route table, a root component and the
 * `index.html` every Vite project has. What it does not supply is the request
 * handler, the mode dispatch, the state payload, the client bootstrap, or the
 * shell the handler writes into — which is the client build's own output, so
 * the page asks for the assets that build emitted.
 */

import type { ParamsForPattern, RenderMode } from './ssg.js';

export type { RenderMode };

export interface ServerRenderOptions {
  /**
   * The module exporting `routes`, as the application would import it.
   *
   * A path and not a table, because the table is the application's and the two
   * halves below have to import it under the same specifier the application
   * does — one build, one module.
   */
  routes?: string;
  /**
   * The module exporting the root component as `default` or `App`.
   *
   * The component the router renders its outlet inside. Every page's markup
   * comes from here.
   */
  root?: string;
  /**
   * What a route that declares no mode of its own renders as.
   *
   * `ssr`, because an application that turned this on has said it wants a
   * server. A route says `csr` to opt back out, which is the direction that
   * keeps the roadmap's promise: server rendering is chosen, and choosing it
   * once for the application does not take the choice away per route.
   */
  defaultMode?: RenderMode;
  /** Where server-function calls arrive; must match the client transform. */
  base?: string;
  /**
   * The application's server entry, from the project root.
   *
   * What `vite build` builds into `server/` and what `vite` answers requests
   * with, so one module is both the deployable and the thing developed
   * against. It exports the handler the way a host expects one:
   *
   *     import { handler } from 'virtual:volt/server';
   *     export default { fetch: handler };
   */
  entry?: string;
  /**
   * What to write an `ssg` pattern with a parameter for.
   *
   * `vite build` writes every `ssg` route's page into the client's directory,
   * and a pattern such as `/docs/:page` names no path on its own. This is
   * asked once per such pattern, with the pattern and the route's id, and
   * answers with the parameters of each page to write — `[{ page: 'intro' },
   * { page: 'install' }]` — or with nothing, which fails the build where a
   * parameter is required: a page left unwritten with no word said is one the
   * handler renders for whoever asks, and nobody would know. An empty list
   * writes none, and leaves every path of the pattern to the handler, as is
   * any path the answer does not name. A pattern whose parameters can all be
   * left out, `/docs/:page?` or `/docs/*`, is written at `/docs` when this
   * answers with nothing or an empty list; an answer with values is the whole
   * of what is written, and `{}` among them is `/docs`. A page whose last
   * segment would be `index` fails the build: its file is the one a host
   * serves at its directory's address. A function rather than a list,
   * because the paths of such a route come from somewhere — a directory of
   * files, a content API — and `vite.config.ts` is where a build can read it:
   * it runs in Node, where the route table, which is on the render path, may
   * not.
   */
  params?: ParamsForPattern;
}

/** The request handler, which the application's server entry exports. */
export const SERVER_ID = 'virtual:volt/server';
/** The browser bootstrap, which the application's client entry imports. */
export const CLIENT_ID = 'virtual:volt/client';
/**
 * The page the handler writes into, as a string.
 *
 * The client build's emitted `index.html` in a build — with the hashed module
 * script and the stylesheet link in it — and the project's own on a dev
 * server, where the source entry is what the dev server compiles on request.
 */
export const SHELL_ID = 'virtual:volt/shell';

/** Where in the shell the handler writes a page, spelled the one way it looks for. */
export const MOUNT_POINT = '<div id="app"></div>';

/**
 * The attribute a rendered mount point names its path in.
 *
 * Here rather than beside `BUILD_ATTRIBUTE` in core, because both ends of it
 * are generated by this module and nothing else reads it.
 */
const PATH_ATTRIBUTE = 'data-volt-path';

/**
 * The attribute marking the element a page carries its loaders' answers in.
 *
 * An element of its own rather than keys in the state payload, whose keys are
 * names an application chose: any spelling reserved there is one it could
 * choose too. Here for the reason `PATH_ATTRIBUTE` is.
 */
const LOADERS_ATTRIBUTE = 'data-volt-loaders';

/**
 * The `Symbol.for` key of the function a built server bundle hands its `ssg`
 * pages to, for the build that starts it to write them. See `serverModule`.
 */
export const PAGES_REGISTRY = 'volt.ssg-pages';

/**
 * Why the handler cannot write into this shell, naming `where`; null if it can.
 *
 * The client takes `#app` however the shell spells it, and the handler looks
 * for one spelling. A shell with another has nowhere for the render to go, and
 * a render written anywhere else is one the client never claims: it finds its
 * mount point empty and unmarked, builds the page into it, and the reader gets
 * two copies of the page, one of which never wakes. So the shell is refused
 * where it is loaded — failing the build, or the dev server's request — rather
 * than answered with that.
 */
export function missingMountPoint(shell: string, where: string): string | null {
  if (shell.includes(MOUNT_POINT)) return null;
  return (
    `[volt] ${where} has no ${MOUNT_POINT}. serverRender writes each page into that element, ` +
    'spelled exactly so — no attributes, nothing inside it — and the client attaches to what ' +
    'it finds there. Put one in the <body>, and style an element around it instead of it.'
  );
}

/** Every option decided, so the generated modules never default one twice. */
export interface ResolvedServerRender {
  readonly routes: string;
  readonly root: string;
  readonly defaultMode: RenderMode;
  readonly base: string;
  readonly entry: string;
  /** Not defaulted: a pattern nothing answers for is the build's to refuse. */
  readonly params?: ParamsForPattern;
}

/** `serverRender: true` and a partial object, as the one shape the rest reads. */
export function resolveServerRender(options: ServerRenderOptions | true): ResolvedServerRender {
  const given = options === true ? {} : options;
  return {
    routes: given.routes ?? '/src/routes.js',
    root: given.root ?? '/src/app.js',
    defaultMode: given.defaultMode ?? 'ssr',
    base: given.base ?? '/_volt/',
    entry: given.entry ?? '/server.ts',
    params: given.params,
  };
}

/** How the generated server module is being run. */
export interface ServerModuleOptions {
  /**
   * Under a dev server, where a failure should reach the overlay.
   *
   * A deployed handler answers a loader or a render that threw with a bare
   * 500, because what the error says — a driver's message, a stack — is not
   * for the stranger who asked. On a dev server the person who asked wrote
   * the code, and a 500 that says nothing sends them to the terminal to find
   * out which line it was. So there it is thrown, and the dev server shows it
   * in the page with the stack pointing at the source.
   */
  dev?: boolean;
}

/**
 * The server half: one `(Request) => Promise<Response>`.
 *
 * That shape is not decoration. The roadmap's edge mode "falls out of the
 * handler being a `(Request) => Response` function, provided nothing on the
 * render path reaches for a `node:` builtin" — which `renderPath` enforces
 * separately. Nothing here opens a file or reads a process.
 *
 * The order of the three branches is the whole logic. Server-function calls go
 * first, because they are POSTs to a path the router knows nothing about. A
 * URL the table does not match still gets the shell, with a 404 status: the
 * application's own not-found route is a route, and answering 200 for a URL
 * that does not exist would be worse than answering 404 with a page that says
 * so. And a `csr` route gets the shell unrendered, which is the opt-out.
 */
export function serverModule(
  options: ResolvedServerRender,
  build: string,
  { dev = false }: ServerModuleOptions = {},
): string {
  return `import { createRouter, flattenRoutes, matchRoutes, provideRouter, routeMode } from '@voltdev/router';
import { escapeJsonForScript, renderToString, stateJson } from '@voltdev/core/server';
import { BUILD_ATTRIBUTE, needsHydration, provideOutlet } from '@voltdev/core';
import { createHandler, isServerCall, withRequest } from '@voltdev/server';
import shell from ${JSON.stringify(SHELL_ID)};
import { routes } from ${JSON.stringify(options.routes)};
import App from ${JSON.stringify(options.root)};

const branches = flattenRoutes(routes);
const functions = createHandler({ base: ${JSON.stringify(options.base)} });

const MARKER = ${JSON.stringify(MOUNT_POINT)};

/**
 * What this build calls itself.
 *
 * Written onto the mount point when the server rendered into it, and compared
 * by the client before it claims a single node — markup printed by another
 * build resolves every path and lands on the wrong nodes, which nothing on the
 * page can detect afterwards.
 */
const BUILD = ${JSON.stringify(build)};

/**
 * Where the mount point says which path it was rendered for.
 *
 * Beside the build's mark, because a host that rewrites a URL hands the
 * browser one route's markup at another route's address, and the client
 * resolves the address: its paths would land on the nodes of a page it is not.
 */
const PATH = ${JSON.stringify(PATH_ATTRIBUTE)};

/** The module script, and the only JavaScript the shell asks for. */
const SCRIPT = /<script\\b[^>]*\\btype=["']module["'][^>]*><\\/script>/;

/**
 * The shell either side of its mount point, cut once.
 *
 * Joined per request rather than spliced with \`replace\`, because a
 * replacement string is read for patterns — \`$$\` is one dollar and \`$'\` is
 * everything after the match — and what goes in here is whatever the render
 * wrote: a price, a formula, a stylesheet's \`content\`. The client claims the
 * static text as it arrives and never writes it again, and adopts the payload
 * as it arrives.
 */
function cut(page) {
  const at = page.indexOf(MARKER);
  return [page.slice(0, at), page.slice(at + MARKER.length)];
}

/**
 * With the module script and without it.
 *
 * Taken out of the shell rather than out of the finished page, where the first
 * match could as well be one the render printed.
 */
const LIVE = cut(shell);
const INERT = cut(shell.replace(SCRIPT, ''));

/**
 * Has this route anything at all to attach in a browser?
 *
 * Every component the URL matched is asked, because the outlet renders the
 * leaf's markup inside the layout's and either can have a binding in it. Each
 * component's answer already covers everything its own template reaches — a
 * child component is constructed by a runtime call, so a layout that renders
 * one is dynamic whatever its own markup looks like.
 *
 * A route with no components at all answers "yes". Unknown is not static.
 */
function interactive(matches) {
  // The root is asked with the rest of them. It renders on every page, and an
  // application whose only binding is in its own navigation would otherwise be
  // sent a page with nothing to attach it.
  const components = [App, ...matches.map((match) => match.route.component)].filter(Boolean);
  return components.length === 0 || components.some((component) => needsHydration(component));
}

/** Where the page carries its loaders' answers. */
const LOADERS = ${JSON.stringify(LOADERS_ATTRIBUTE)};

/**
 * What the branch's loaders answered, as the element that carries it to the
 * client that claims this page, or nothing when none of them answered.
 *
 * Through the state payload's serializer: a value JSON would carry wrongly is
 * refused as it is there, rather than reaching the browser as something the
 * page was not rendered from, and \`<\` is escaped, so an answer holding
 * \`</script>\` cannot end the element. Under the path the answers are for,
 * which is where the client looks for them.
 */
function carry(path, values, matches) {
  let json;
  try {
    json = stateJson(values ?? {});
  } catch (error) {
    // The serializer names the depth it refused; a reader knows the route by
    // its pattern.
    throw new Error(
      '[volt] The loader of ' + matches[error?.detail?.key]?.pattern + ' answered with a value ' +
        'this page cannot carry to the browser. ' + error?.message,
      { cause: error },
    );
  }
  if (json === '') return '';
  const key = escapeJsonForScript(JSON.stringify(path));
  return '<script type="application/json" ' + LOADERS + '>{' + key + ':' + json + '}</script>';
}

function page(html, state, styles, status, script = true, path = '') {
  // Into the mount point rather than appended: the shell is the application's
  // own file and the mount point is where it says the application goes.
  // Declining to ship the JavaScript, which is the whole of partial hydration
  // once the boundary is known: a page of prose and links has nothing to
  // attach, so it asks for neither the bundle that would attach it nor the
  // values it would have attached.
  const [before, after] = script ? LIVE : INERT;
  // The state payload exists so hydration can start from what the server
  // settled on. A page that will not hydrate has nothing to read it, and on a
  // page of prose it can easily be the larger half.
  const carried = script ? state : '';
  // The mount point says which build filled it and for which path, and says
  // nothing when nothing did: a page the client must build for itself is a
  // page with no mark. A path keeps its \`&\` — nothing else in one needs
  // escaping in an attribute — and the parser hands the client it back.
  const opened = html
    ? '<div id="app" ' + BUILD_ATTRIBUTE + '="' + BUILD + '" ' + PATH + '="' +
      path.replaceAll('&', '&amp;') + '">'
    : '<div id="app">';
  // A function, so the stylesheets are not read for patterns either.
  const head = styles ? before.replace('</head>', () => styles + '</head>') : before;
  return new Response(head + opened + html + '</div>' + carried + after, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function handler(request) {
  // \`isServerCall\` rather than a prefix test: it requires a POST and compares
  // against the base with its trailing slash, so a page at \`/_voltage\` — or a
  // reader who typed a function URL into the address bar — is routed as a page
  // instead of being handed to the function handler and answered 405.
  if (isServerCall(request, ${JSON.stringify(options.base)})) return functions(request);

  try {
    return await respond(request);
  } catch (error) {
    ${dev ? 'throw error;' : "return new Response('Internal Server Error', { status: 500 });"}
  }
}

/**
 * The page for a request, or the failure as it was.
 *
 * Thrown rather than answered, because what to make of a failure is the
 * caller's: the handler above answers a stranger with a bare 500 or throws
 * it on to a dev server's overlay, and the build below writes an \`ssg\`
 * page from what this returns, and fails naming the page and the error
 * when it throws — where a page with the failure in it would be served as
 * bytes to everyone.
 */
async function respond(request) {
  let url = new URL(request.url);

  // Every route that renders for this URL, outermost first — and an empty list,
  // not null, when nothing does. An empty array is truthy, so the test is on
  // its length.
  const matches = matchRoutes(branches, url.pathname);
  if (matches.length === 0) return page('', '', '', 404);

  const mode = routeMode(matches, ${JSON.stringify(options.defaultMode)});
  if (mode === 'csr') return page('', '', '', 200);

  // An \`ssg\` page is everyone's by its own declaration, and the build writes
  // it once, from a request that is nobody's. Rendered here from that same
  // request rather than this reader's, so a host that sends the path here
  // instead of serving the file gets the file's bytes — not a page made from
  // this reader's cookies, at an address that promises everyone one page —
  // and a loader that needs a reader fails under \`vite\` as it will fail the
  // build.
  if (mode === 'ssg') {
    request = everyones(url.pathname);
    url = new URL(request.url);
  }

  // One router per request, and never one at module scope: a router there
  // would be shared by every request in flight, and the second reader would
  // see the first reader's page.
  const router = createRouter({ routes });

  // A server function called while this page is produced is a direct call on
  // the server, with no function handler to say whose request it is — so the
  // request is lent to each synchronous span of the work, and taken back
  // before every \`await\`, where another request's work runs next.
  const around = (run) => withRequest(request, run);

  // Wrapping \`resolve\` covers the loaders only because it calls every one of
  // them before it first awaits anything; the router's own tests hold it to
  // that. A loader is also how fetched data reaches the markup at all: its
  // answer is in place before the first byte is written, where a call made
  // during the render answers after the bytes it would have filled are gone.
  const resolved = await around(() => router.resolve(url));
  if (resolved.status === 'failed') throw resolved.error;
  // The loaders' answers as they stood when they answered, before a render
  // can have done anything to them: the client that claims the page starts
  // from them and renders what this render did. Only for a page that will be
  // claimed, since nothing else reads them.
  const script = interactive(matches);
  const answers = script ? carry(url.pathname, resolved.data?.[url.pathname], matches) : '';
  // Everything a route reads is in place before a byte is written, and the
  // branch renders through the outlets in the application's own templates —
  // which is what makes this a page rather than a shell with a gap in it.
  const rendered = await renderToString(App, {
    around,
    setup: () => {
      provideRouter(router);
      provideOutlet(router.outletAt(0));
    },
  });
  if (rendered.status !== 200) throw rendered.error;
  const styles = [...rendered.styles.values()].map((css) => '<style>' + css + '</style>').join('');
  const answer = page(
    rendered.html,
    (rendered.state ?? '') + answers,
    styles,
    200,
    script,
    url.pathname,
  );
  // An \`ssr\` page is this reader's: every guard its loaders and functions ran
  // read this request, and a cache in front of the host keeps pages by URL,
  // so kept there it is the next reader's page too. \`private\` rather than the
  // \`no-store\` a server function's answer carries, because the reader's own
  // browser keeping it harms nobody and keeps Back instant. An \`ssg\` page is
  // the same for everyone by its own declaration, which is what makes it one a
  // shared cache should keep.
  if (mode === 'ssr') answer.headers.set('cache-control', 'private');
  return answer;
}

/**
 * The request an \`ssg\` page is rendered from, wherever it is rendered: a GET
 * of its path, with no query, no headers, no cookies, and the same origin
 * every time. The build writes the page from it and the handler answers the
 * path from it, so the two are one page.
 */
function everyones(pathname) {
  const url = new URL('http://localhost');
  // Set rather than appended, so a \`?\` or a \`#\` in a parameter's value
  // stays in the path instead of starting a query or a fragment.
  url.pathname = pathname;
  return new Request(url);
}

/**
 * What \`vite build\` writes the \`ssg\` pages through once it has built this
 * bundle: the table, so it can say which paths are \`ssg\`, and a path's page —
 * or null where the route that answers the path is not \`ssg\`, which a value
 * a parameter was given can make it. A path no route answers is \`respond\`'s
 * 404, whatever the default mode, so the build says that rather than blaming
 * a route.
 *
 * Filed rather than exported, because the entry a host runs is the
 * application's own and exports what it chooses: a \`fetch\` that wraps the
 * handler as readily as the handler. The build starts this bundle in a thread
 * of its own and puts a function on that thread's \`globalThis\` first, which
 * this hands its pages to; a host puts none there, so in a deploy this files
 * nothing. The page is \`respond\`'s rather than \`handler\`'s, so a failure
 * reaches the build as what it was, not as a bare 500.
 */
globalThis[Symbol.for(${JSON.stringify(PAGES_REGISTRY)})]?.({
  branches,
  render(pathname) {
    const request = everyones(pathname);
    const matches = matchRoutes(branches, new URL(request.url).pathname);
    if (matches.length > 0 && routeMode(matches, ${JSON.stringify(options.defaultMode)}) !== 'ssg') {
      return null;
    }
    return respond(request);
  },
});

export { branches, routes };
`;
}

/**
 * The client half: take over the page the server sent, or build one.
 *
 * One entry for both, because the page cannot tell the browser which it is
 * receiving and should not have to. What decides is what the server said it
 * did, which it says with the identity of the build that did it.
 *
 * The order matters and is the same either way: resolve, then attach, then
 * listen. Resolving first puts every route's data and every depth's component
 * in place, so the render — whether it claims the server's nodes or builds its
 * own — is the render the page is meant to show. Listening last means the
 * first click cannot arrive before the page it would navigate from exists.
 */
export function clientModule(options: ResolvedServerRender, build: string): string {
  // Both entries whatever the default mode says. The default is only the
  // fallback: a route that declares `ssr` or `ssg` under a `csr` default is
  // rendered by the server all the same, and a client that could only mount
  // would throw every one of those pages away and build it again. Which
  // routes do that is the route table's business and is not known here, so
  // the hydration walk is in every client `serverRender` generates.
  return `import { BUILD_ATTRIBUTE, STATE_ATTRIBUTE, hydrate, mount, provideOutlet } from '@voltdev/core';
import { createRouter, provideRouter } from '@voltdev/router';
import { routes } from ${JSON.stringify(options.routes)};
import App from ${JSON.stringify(options.root)};

const host = document.querySelector('#app');
if (host) {
  // Decided by what the server said it did, which is the only thing that
  // knows: the mount point carries the identity of the build that filled it
  // and the path it filled it for, and nothing else on the page answers the
  // question. Children do not — a \`csr\` route's mount point is empty on a
  // server-rendered site, and a shell with a spinner in it is not. Markup
  // from another build, or rendered for another path than the one this
  // client resolves — a host that rewrites URLs — is markup whose paths would
  // resolve onto the wrong nodes: a claim compares only a root's tag.
  const claims =
    host.getAttribute(BUILD_ATTRIBUTE) === ${JSON.stringify(build)} &&
    host.getAttribute(${JSON.stringify(PATH_ATTRIBUTE)}) === location.pathname;
  // Building it again is right, and costs the reader a second paint of a page
  // they already had. Nobody chose that, so development says which half of
  // the deploy is out of step. A mount point with no mark is a \`csr\` page,
  // which was never the server's to print.
  if (__VOLT_DEV__ && !claims && host.hasAttribute(BUILD_ATTRIBUTE)) {
    const mark = host.getAttribute(BUILD_ATTRIBUTE);
    console.warn(
      mark === ${JSON.stringify(build)}
        ? '[volt] This page was rendered for ' + host.getAttribute(${JSON.stringify(PATH_ATTRIBUTE)}) +
            ' and opened at ' + location.pathname + ', so it is built again rather than claimed. ' +
            'Something between the server and the browser answered one path with the page for another.'
        : '[volt] This page was rendered by build ' + mark + ' and this client is build ' +
            ${JSON.stringify(build)} + ', so it is built again rather than claimed. ' +
            'A cache is serving a page from another deploy, or the server and the client were built apart.',
    );
  }
  // Values go with the markup they were printed with, before anything can
  // start from one. A payload's keys are names its authors chose, and the
  // build that wrote this page may have kept a name and changed what it
  // holds — which a component adopting it would show, and would not fetch
  // again.
  if (!claims) document.querySelector('script[' + STATE_ATTRIBUTE + ']')?.remove();
  const data = loaderAnswers(claims);

  const router = createRouter({ routes });
  const setup = () => {
    provideRouter(router);
    provideOutlet(router.outletAt(0));
  };

  // Before anything renders: a page claimed with an unresolved router would
  // claim a branch that is not there yet, and a page built with one would
  // build the shell and nothing under it. A resolve that fails still attaches:
  // the router says where the page is, and its outlets keep what the server
  // wrote there until a navigation replaces it. The loaders the page carried
  // answers for are not asked again; every later navigation asks its own.
  await router.resolve(location.href, { data });

  // Two entries rather than a flag, because a flag would put the hydration
  // walk on \`mount\`'s own path where no bundler could drop it.
  if (claims) hydrate(App, host, { setup });
  else mount(App, host, { setup });

  // Listening, and not resolving again: the page the reader is looking at is
  // the page this router just resolved, and running every loader a second time
  // for it is work nobody asked for.
  await router.start({ resolve: false });
}

/**
 * What the server's loaders answered for this page, for a client that claims
 * it; nothing for one that builds its own.
 *
 * The answers go with the markup they were printed with, for the reason the
 * state payload does: another build's may have kept a route and changed what
 * its loader answers, and another path's are another branch's. They are keyed
 * by that path too, so the router finds none at any other. Taken out of the
 * page either way, because nothing reads them twice.
 */
function loaderAnswers(claims) {
  const carried = document.querySelector('script[' + ${JSON.stringify(LOADERS_ATTRIBUTE)} + ']');
  carried?.remove();
  if (!claims || !carried) return undefined;
  try {
    return JSON.parse(carried.textContent ?? '');
  } catch (error) {
    // Cut short or rewritten in transit. The loaders are asked again, which
    // is slower and right, and only a development build says why.
    if (__VOLT_DEV__) {
      console.warn('[volt] The loader answers this page carried did not parse; its loaders run again.', error);
    }
    return undefined;
  }
}
`;
}
