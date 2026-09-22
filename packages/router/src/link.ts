/**
 * Links are real links, and interception is layered on top.
 *
 * There is no `<Link>` component here and no `:navigate` directive, because
 * every replacement for `<a href>` loses something the platform gives away:
 * the status bar preview, "copy link address", middle-click to open a tab,
 * Ctrl-click, the browser's own history heuristics, and — the one that is
 * invisible until it matters — a crawler that reads `href` and never runs a
 * click handler. So the application writes an ordinary anchor with an ordinary
 * `href`, and a single delegated listener decides, per click, whether the
 * router should handle it instead of the browser.
 *
 * "Instead of the browser" is the whole test. Every case below is one where
 * the user asked for something the router cannot do — a new tab, a download, a
 * different origin — and in each of them the right move is to do nothing at
 * all and let the click through untouched.
 */

/** Opt a single anchor out of interception: `<a href="/docs" data-volt-no-router>`. */
export const NO_ROUTER_ATTRIBUTE = 'data-volt-no-router';

/**
 * The anchor a click landed in, if any.
 *
 * `composedPath` rather than `closest` on the target, because a click inside
 * an open shadow root reports the host as its target and `closest` would then
 * search from the wrong side of the boundary — the anchor is in the path
 * either way.
 */
export function findAnchor(event: Event): HTMLAnchorElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const node of path) {
    if (node instanceof HTMLAnchorElement) return node;
    // The path continues past the document into the window; nothing above the
    // document can be an anchor, and `instanceof` on it is wasted work.
    if (node instanceof Document) break;
  }
  return null;
}

/**
 * Whether this anchor is one the router could take over at all.
 *
 * Separate from the click checks so hovering can ask the same question: a
 * pointer event has no button and no modifiers to inspect, but it does want to
 * know whether preloading this href would ever pay off.
 */
export function isRoutableAnchor(anchor: HTMLAnchorElement): boolean {
  // An unresolvable or absent href is not a link at all — `<a>` without one is
  // a placeholder, and the browser treats it as inert text.
  if (!anchor.getAttribute('href')) return false;

  if (anchor.hasAttribute(NO_ROUTER_ATTRIBUTE)) return false;

  // `download` means "save this", which a client-side navigation cannot do.
  if (anchor.hasAttribute('download')) return false;

  // Anything other than the current browsing context is the browser's job:
  // _blank, a named frame, _parent, _top.
  const target = anchor.getAttribute('target');
  if (target && target !== '_self') return false;

  // The documented escape hatch for a same-origin URL the server owns, and the
  // same token search engines already read.
  if (anchor.rel.split(/\s+/).includes('external')) return false;

  // Another origin, and every non-http scheme with it: mailto:, tel:, blob:
  // and a `javascript:` href all report an origin that is not this one.
  //
  // "This one" is the anchor's own document rather than `window`. They are the
  // same page in the ordinary case; they are not for an anchor in a frame, and
  // reaching for a global here is how a module that only ever runs in a
  // browser still manages to name one on a server.
  return anchor.origin === anchor.ownerDocument.location?.origin;
}

/**
 * Whether this click should become a navigation rather than a page load.
 *
 * The modifier and button tests are the ones that matter most in practice and
 * are the ones most often missing: a Cmd-click that gets intercepted opens the
 * page in the current tab, which silently destroys whatever the user had open
 * and looks like the application eating their work.
 */
export function shouldInterceptClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  // Someone downstream already decided what this click means. Handling it too
  // would run both behaviours.
  if (event.defaultPrevented) return false;

  // Only a plain primary click. Middle-click opens a tab, right-click opens a
  // menu, and the browser does both without asking.
  if (event.button !== 0) return false;

  // Cmd/Ctrl opens a new tab, Shift a new window, Alt downloads. All three are
  // requests for a *second* place to look at this URL, which is the one thing
  // a same-document navigation cannot provide.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  return isRoutableAnchor(anchor);
}
