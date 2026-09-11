/**
 * `start`: the wiring an application would otherwise write by hand.
 *
 * The router, the query cache, server rendering and server functions are each
 * a deliverable and each works; none of them is a way to begin. This mode puts
 * them together — and it is opt-in, because the roadmap's own position is that
 * CSR is first-class and server rendering is something an application chooses,
 * never the price of using the framework. A turnkey mode that quietly made
 * every project a server project would contradict that, so `start` is `false`
 * until somebody writes `true`.
 *
 * **The wiring is generated into the application's own module graph**, as two
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
 * What the application supplies is a route table and a shell. What it does not
 * supply is the request handler, the mode dispatch, the state payload or the
 * client bootstrap.
 */

/** Where a route's markup is produced; the router's own type, restated. */
export type RenderMode = 'csr' | 'ssr' | 'ssg';

export interface StartOptions {
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
}

export const SERVER_ID = 'virtual:volt-start/server';
export const CLIENT_ID = 'virtual:volt-start/client';

export interface ResolvedStart {
  readonly routes: string;
  readonly root: string;
  readonly defaultMode: RenderMode;
  readonly base: string;
}

export function resolveStart(options: StartOptions | true): ResolvedStart {
  const given = options === true ? {} : options;
  return {
    routes: given.routes ?? '/src/routes.js',
    root: given.root ?? '/src/app.js',
    defaultMode: given.defaultMode ?? 'ssr',
    base: given.base ?? '/_volt',
  };
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
export function serverModule(start: ResolvedStart): string {
  return `import { flattenRoutes, matchRoutes, routeMode } from '@voltdev/router';
import { renderToString } from '@voltdev/core/server';
import { needsHydration } from '@voltdev/core';
import { createHandler } from '@voltdev/server';
import { routes } from ${JSON.stringify(start.routes)};
import App from ${JSON.stringify(start.root)};

const branches = flattenRoutes(routes);
const functions = createHandler({ base: ${JSON.stringify(start.base)} });

/** The shell, with the render dropped into it. Set by the caller. */
let shell = '<!doctype html><html><body><div id="app"></div></body></html>';
export function setShell(html) {
  shell = html;
}

const MARKER = '<div id="app"></div>';

/** The module script, and the only JavaScript the shell asks for. */
const SCRIPT = /<script\\b[^>]*\\btype=["']module["'][^>]*><\\/script>/;

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
  const components = matches.map((match) => match.route.component).filter(Boolean);
  return components.length === 0 || components.some((component) => needsHydration(component));
}

function page(html, state, styles, status, script = true) {
  // Replaced rather than appended: the shell is the application's own file and
  // the mount point is where it says the application goes.
  // The state payload exists so hydration can start from what the server
  // settled on. A page that will not hydrate has nothing to read it, and on a
  // page of prose it can easily be the larger half.
  const carried = script ? state : '';
  const filled = shell.includes(MARKER)
    ? shell.replace(MARKER, '<div id="app">' + html + '</div>' + carried)
    : shell + html + carried;
  // Declining to ship the JavaScript, which is the whole of partial hydration
  // once the boundary is known: a page of prose and links has nothing to
  // attach, so it asks for neither the bundle that would attach it nor the
  // values it would have attached.
  const body = script ? filled : filled.replace(SCRIPT, '');
  return new Response(styles ? body.replace('</head>', styles + '</head>') : body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function handler(request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith(${JSON.stringify(start.base)})) return functions(request);

  // Every route that renders for this URL, outermost first — and an empty list,
  // not null, when nothing does. An empty array is truthy, so the test is on
  // its length.
  const matches = matchRoutes(branches, url.pathname);
  if (matches.length === 0) return page('', '', '', 404);

  const mode = routeMode(matches, ${JSON.stringify(start.defaultMode)});
  if (mode === 'csr') return page('', '', '', 200);

  const rendered = await renderToString(App, { url: url.href });
  if (rendered.status !== 200) {
    return new Response('Internal Server Error', { status: 500 });
  }
  const styles = [...rendered.styles.values()].map((css) => '<style>' + css + '</style>').join('');
  return page(rendered.html, rendered.state ?? '', styles, 200, interactive(matches));
}

export { branches, routes };
`;
}

/**
 * The client half: hydrate what the server sent, or mount if it sent nothing.
 *
 * One entry for both, because the page cannot tell the browser which it is
 * receiving and should not have to. The mount point either has children the
 * server wrote, or it does not.
 */
export function clientModule(start: ResolvedStart): string {
  const attaches = start.defaultMode !== 'csr';
  return `import { ${attaches ? 'hydrate, mount' : 'mount'} } from '@voltdev/core';
import App from ${JSON.stringify(start.root)};

const host = document.querySelector('#app');
if (host) {
${
  attaches
    ? `  // Two entries rather than a flag, because a flag would put the hydration
  // walk on \`mount\`'s own path where no bundler could drop it. Which one runs
  // is decided by what the server sent: an \`ssr\` route's mount point has the
  // server's nodes in it and a \`csr\` route's is empty, and this build's
  // templates can do either — \`start\` compiles them to claim, and claiming
  // nothing is what building is.
  if (host.firstChild) hydrate(App, host);
  else mount(App, host);`
    : `  // Every route in this project renders in the browser, so there is never
  // anything to attach to and the hydration walk is not imported at all.
  mount(App, host);`
}
}
`;
}
